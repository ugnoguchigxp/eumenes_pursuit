/**
 * LARM Control plane access: bearer auth, per-request timeouts, bounded JSON reads.
 * Self-contained on purpose; Eumenes has its own LARM domain.
 */

export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

/** A control-plane request that failed. Never carries the token or request bodies. */
export class LarmControlError extends Error {
	readonly code: string;
	readonly status: number;
	/** `error.code` of the LARM error body, when it had one. */
	readonly remoteCode: string | undefined;

	constructor(code: string, status = 0, remoteCode?: string) {
		super(remoteCode ? `${code} (${remoteCode})` : code);
		this.name = "LarmControlError";
		this.code = code;
		this.status = status;
		this.remoteCode = remoteCode;
	}
}

export interface ControlRequest {
	readonly method?: "GET" | "POST" | "PUT" | "DELETE";
	/** JSON body (serialized with `content-type: application/json`). */
	readonly json?: unknown;
	/** Raw text body (e.g. JSONL); requires `contentType`. */
	readonly text?: string;
	readonly contentType?: string;
	/** Sent as `Idempotency-Key`. Required by LARM for every mutating training API. */
	readonly idempotencyKey?: string;
	/** Statuses that are not errors. Default `[200]`. */
	readonly accepted?: readonly number[];
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface Control {
	readonly origin: URL;
	/** Sends the request with the bearer token; throws `LarmControlError` unless the status is accepted. */
	request(path: string, init?: ControlRequest): Promise<Response>;
	/** Like `request`, then reads a bounded JSON body. */
	json(path: string, init?: ControlRequest): Promise<unknown>;
}

export interface ControlOptions {
	readonly origin: string;
	readonly token: string;
	readonly fetch?: FetchLike;
	/** Default per-request timeout. */
	readonly timeoutMs?: number;
}

export const DEFAULT_CONTROL_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 1_000_000;

export function parseOrigin(origin: string): URL {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new LarmControlError("larm_invalid_origin");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== ""
	)
		throw new LarmControlError("larm_invalid_origin");
	return new URL(url.origin);
}

/** Reads a response body as JSON with a size bound. */
export async function readJsonBody(
	response: Response,
	limit = MAX_JSON_BYTES,
): Promise<unknown> {
	const text = await response.text();
	if (text.length === 0)
		throw new LarmControlError("larm_empty_response", response.status);
	if (text.length > limit)
		throw new LarmControlError("larm_response_too_large", response.status);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new LarmControlError("larm_invalid_json", response.status);
	}
}

/** Extracts `{error:{code}}` from an error body without throwing. */
export async function readErrorCode(
	response: Response,
): Promise<string | undefined> {
	try {
		const text = (await response.text()).slice(0, 20_000);
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
			const error = (parsed as { error: unknown }).error;
			if (typeof error === "object" && error !== null && "code" in error) {
				const code = (error as { code: unknown }).code;
				if (typeof code === "string" && code.length <= 100) return code;
			}
		}
	} catch {
		// not a LARM error body
	}
	return undefined;
}

export function createControl(options: ControlOptions): Control {
	const origin = parseOrigin(options.origin);
	const { token } = options;
	if (token.length === 0) throw new LarmControlError("larm_unconfigured");
	const doFetch: FetchLike =
		options.fetch ?? ((input, init) => fetch(input, init));
	const defaultTimeout = options.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;

	async function request(
		path: string,
		init: ControlRequest = {},
	): Promise<Response> {
		const url = new URL(path, origin);
		if (url.origin !== origin.origin)
			throw new LarmControlError("larm_control_origin_mismatch");
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
		};
		let body: string | undefined;
		if (init.json !== undefined) {
			headers["content-type"] = "application/json";
			body = JSON.stringify(init.json);
		} else if (init.text !== undefined) {
			headers["content-type"] = init.contentType ?? "text/plain";
			body = init.text;
		}
		if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
		const timeout = AbortSignal.timeout(init.timeoutMs ?? defaultTimeout);
		const signal = init.signal
			? AbortSignal.any([init.signal, timeout])
			: timeout;
		const response = await doFetch(url, {
			method: init.method ?? "GET",
			headers,
			redirect: "error",
			signal,
			...(body === undefined ? {} : { body }),
		});
		const accepted = init.accepted ?? [200];
		if (!accepted.includes(response.status)) {
			const remote = await readErrorCode(response);
			throw new LarmControlError(
				`larm_control_${response.status}`,
				response.status,
				remote,
			);
		}
		return response;
	}

	return {
		origin,
		request,
		async json(path, init) {
			return readJsonBody(await request(path, init));
		},
	};
}

/** Abortable sleep. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
