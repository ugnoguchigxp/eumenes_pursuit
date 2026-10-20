import { z } from "zod";
import type {
	Answer,
	JudgePort,
	JudgeRequest,
	JudgeResponse,
	Question,
	VersionRef,
} from "../../src/contracts/judge.ts";
import type { FetchLike } from "./control.ts";

export const MAX_QUESTIONS = 16;
export const MAX_STATE_BYTES = 50_000;
const DEFAULT_INFER_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_CHARS = 2_000_000;

/** A decision-endpoint failure. `httpStatus` mirrors the server's, or what it would have been for local checks. */
export class LarmDecisionError extends Error {
	readonly code: string;
	readonly httpStatus: number;

	constructor(code: string, httpStatus: number, detail?: string) {
		super(detail ? `${code}: ${detail}` : code);
		this.name = "LarmDecisionError";
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

/** What the judge needs from a claimed provider. The token is only ever sent to `endpoint`. */
export interface ClaimedDecisionProvider {
	readonly endpoint: string;
	readonly model: string;
	readonly token: string;
}

/** Supplies a claimed provider for one call; may reconnect and retry once on auth failures. */
export interface ProviderSource {
	withProvider<T>(
		fn: (provider: ClaimedDecisionProvider) => Promise<T>,
		signal: AbortSignal,
	): Promise<T>;
}

export function checkStateSize(state: unknown): void {
	const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
	if (bytes > MAX_STATE_BYTES)
		throw new LarmDecisionError(
			"decision_state_limit",
			413,
			`${bytes} > ${MAX_STATE_BYTES} bytes`,
		);
}

export function checkQuestionCount(count: number): void {
	if (count < 1 || count > MAX_QUESTIONS)
		throw new LarmDecisionError(
			"decision_question_limit",
			422,
			`${count} questions`,
		);
}

/** Request body for `POST <endpoint>`. `adapter` is omitted when none is requested. */
export function buildInferBody(
	model: string,
	request: JudgeRequest,
): Record<string, unknown> {
	return {
		model,
		state: request.state,
		questions: request.questions,
		questionSet: {
			id: request.questionSet.id,
			version: request.questionSet.version,
		},
		...(request.adapter
			? {
					adapter: { id: request.adapter.id, version: request.adapter.version },
				}
			: {}),
	};
}

const probability = z.number().min(0).max(1);

const answerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("noul"),
		noul: probability,
		confidence: probability,
	}),
	z.object({
		type: z.literal("choice"),
		choice: z.string().min(1),
		confidence: probability,
		probabilities: z.record(z.string(), probability),
	}),
	z.object({
		type: z.literal("score"),
		score: z.number().min(0),
		confidence: probability,
		probabilities: z.record(z.string(), probability),
	}),
]);

const inferResponseSchema = z.object({
	model: z.string().min(1),
	adapter: z
		.object({ id: z.string().min(1), version: z.number().int() })
		.nullable(),
	answers: z.record(z.string(), answerSchema),
	usage: z.object({ input_tokens: z.number().int().nonnegative() }),
});

function invalid(detail: string): LarmDecisionError {
	return new LarmDecisionError("larm_invalid_response", 200, detail);
}

type RawAnswer = z.infer<typeof answerSchema>;

function mapAnswer(id: string, question: Question, raw: RawAnswer): Answer {
	if (raw.type !== question.type)
		throw invalid(`answer type mismatch for ${id}`);
	switch (raw.type) {
		case "noul":
			return { type: "noul", pYes: raw.noul, confidence: raw.confidence };
		case "choice": {
			if (question.type !== "choice")
				throw invalid(`answer type mismatch for ${id}`);
			if (!(raw.choice in question.criteria))
				throw invalid(`unknown choice for ${id}`);
			for (const key of Object.keys(raw.probabilities))
				if (!(key in question.criteria))
					throw invalid(`unknown choice probability for ${id}`);
			return {
				type: "choice",
				choice: raw.choice,
				confidence: raw.confidence,
				probabilities: raw.probabilities,
			};
		}
		case "score": {
			if (question.type !== "score")
				throw invalid(`answer type mismatch for ${id}`);
			const levels = question.criteria.length;
			if (raw.score > levels - 1) throw invalid(`score out of range for ${id}`);
			const keys = Object.keys(raw.probabilities);
			if (keys.length !== levels)
				throw invalid(`score probability count for ${id}`);
			const probabilities: number[] = [];
			for (let i = 0; i < levels; i++) {
				const value = raw.probabilities[String(i)];
				if (value === undefined)
					throw invalid(`score probability index for ${id}`);
				probabilities.push(value);
			}
			return {
				type: "score",
				score: raw.score,
				confidence: raw.confidence,
				probabilities,
			};
		}
	}
}

function sameAdapter(a: VersionRef | null, b: VersionRef | null): boolean {
	if (a === null || b === null) return a === b;
	return a.id === b.id && a.version === b.version;
}

/**
 * Validates a decision response against the request and maps it to the contract.
 * Throws `LarmDecisionError`: `larm_invalid_response`, `larm_model_mismatch`, `larm_adapter_mismatch`.
 */
export function parseInferResponse(
	raw: unknown,
	request: JudgeRequest,
	claimedModel: string,
): Omit<JudgeResponse, "latencyMs"> {
	const parsed = inferResponseSchema.safeParse(raw);
	if (!parsed.success) throw invalid("schema");
	const body = parsed.data;
	if (body.model !== claimedModel)
		throw new LarmDecisionError("larm_model_mismatch", 200);
	if (!sameAdapter(body.adapter, request.adapter))
		throw new LarmDecisionError("larm_adapter_mismatch", 200);
	const ids = Object.keys(request.questions);
	const answered = Object.keys(body.answers);
	if (answered.length !== ids.length) throw invalid("answer count");
	const answers: Record<string, Answer> = {};
	for (const id of ids) {
		const question = request.questions[id];
		const answer = body.answers[id];
		if (!question || !answer) throw invalid(`missing answer ${id}`);
		answers[id] = mapAnswer(id, question, answer);
	}
	return {
		answers,
		model: body.model,
		adapter:
			body.adapter === null
				? null
				: { id: body.adapter.id, version: body.adapter.version },
		inputTokens: body.usage.input_tokens,
	};
}

async function throwHttpError(response: Response): Promise<never> {
	let code = `larm_http_${response.status}`;
	let detail: string | undefined;
	try {
		const text = (await response.text()).slice(0, 20_000);
		const parsed: unknown = JSON.parse(text);
		const error =
			typeof parsed === "object" && parsed !== null
				? (parsed as { error?: unknown }).error
				: undefined;
		if (typeof error === "object" && error !== null) {
			const { code: c, message } = error as {
				code?: unknown;
				message?: unknown;
			};
			if (typeof c === "string" && /^[a-z0-9_]{1,100}$/.test(c)) code = c;
			if (typeof message === "string") detail = message.slice(0, 200);
		}
	} catch {
		// non-JSON error body: keep the generic code
	}
	throw new LarmDecisionError(code, response.status, detail);
}

export interface JudgeOptions {
	readonly fetch?: FetchLike;
	readonly timeoutMs?: number;
}

/** `JudgePort` over a claimed LARM decision provider. */
export function createDecisionJudge(
	source: ProviderSource,
	options: JudgeOptions = {},
): JudgePort {
	const doFetch: FetchLike =
		options.fetch ?? ((input, init) => fetch(input, init));
	const timeoutMs = options.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS;
	return {
		maxQuestions: MAX_QUESTIONS,
		async ask(request, signal) {
			checkQuestionCount(Object.keys(request.questions).length);
			checkStateSize(request.state);
			return source.withProvider(async (provider) => {
				const started = performance.now();
				const response = await doFetch(provider.endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${provider.token}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(buildInferBody(provider.model, request)),
					redirect: "error",
					signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
				});
				if (!response.ok) return throwHttpError(response);
				const text = await response.text();
				if (text.length > MAX_RESPONSE_CHARS)
					throw invalid("response too large");
				let raw: unknown;
				try {
					raw = JSON.parse(text);
				} catch {
					throw invalid("not json");
				}
				const mapped = parseInferResponse(raw, request, provider.model);
				return {
					...mapped,
					latencyMs: Math.round(performance.now() - started),
				};
			}, signal);
		},
	};
}
