import type { JudgePort } from "../../src/contracts/judge.ts";
import { z } from "zod";
import {
	assertProviderEndpoint,
	DECISION_CAPABILITY,
	discoverTarget,
	type DecisionTarget,
} from "./catalog.ts";
import {
	type Control,
	createControl,
	type FetchLike,
	LarmControlError,
	pause as defaultPause,
} from "./control.ts";
import {
	type ClaimedDecisionProvider,
	createDecisionJudge,
	LarmDecisionError,
	type ProviderSource,
} from "./judge.ts";

export interface OpenLeaseOptions {
	readonly origin: string;
	readonly token: string;
	/** Profile selector saved in settings (`larm.decisionProfile`); the catalog does not expose it. */
	readonly selector: string;
	/** From settings (`larm.audience`). */
	readonly audience: string;
	readonly clientId: string;
	/** Capability used for discovery. */
	readonly catalogCapability?: string;
	readonly fetch?: FetchLike;
	/** Ready-poll interval. Default 1000. */
	readonly pollMs?: number;
	/** Give up waiting for ready after this long. Default 120000. */
	readonly readyTimeoutMs?: number;
	/** Per-inference timeout. Default 60000. */
	readonly inferTimeoutMs?: number;
}

export interface DecisionLease {
	readonly judge: JudgePort;
	/** Connected state, for diagnostics. */
	status(): {
		connected: boolean;
		connectionId: string | undefined;
		expiresAt: number | undefined;
	};
	/** Idempotent. Always attempts to DELETE the connection; stops the renewal timer. */
	release(): Promise<void>;
}

function untilAborted<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		task
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
	});
}

const TTL_SECONDS = 900;
const EXPIRY_MARGIN_MS = 30_000;
const RENEW_FRACTION = 0.5;
const TERMINAL = new Set(["failed", "expired", "released"]);

const connectionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const connectionSchema = z.object({
	id: connectionIdSchema,
	status: z.string(),
	agentProfile: z.string().optional(),
	providers: z
		.array(
			z.object({
				name: z.string(),
				capability: z.string().optional(),
				readiness: z.string().optional(),
				claimable: z.boolean().optional(),
				model: z.string().optional(),
			}),
		)
		.default([]),
});
const claimSchema = z.object({
	id: z.string(),
	status: z.string(),
	expiresAt: z.string(),
	providers: z.array(
		z.object({
			name: z.string(),
			endpoint: z.string(),
			model: z.string(),
			credential: z.object({
				type: z.literal("bearer"),
				token: z.string().min(1),
				expiresAt: z.string().optional(),
			}),
		}),
	),
});

interface Lease {
	readonly id: string;
	provider: ClaimedDecisionProvider;
	expiresAt: number;
	renewTimer: ReturnType<typeof setTimeout> | undefined;
}

export function openDecisionLease(options: OpenLeaseOptions): DecisionLease {
	const capability = options.catalogCapability ?? DECISION_CAPABILITY;
	const control: Control = createControl({
		origin: options.origin,
		token: options.token,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	const pollMs = options.pollMs ?? 1000;
	const readyTimeoutMs = options.readyTimeoutMs ?? 120_000;

	let target: DecisionTarget | undefined;
	let lease: Lease | undefined;
	let connecting: Promise<Lease> | undefined;
	let closed = false;
	let releasing: Promise<void> | undefined;

	async function deleteConnection(id: string): Promise<void> {
		await control.request(`/v1/agent-connections/${encodeURIComponent(id)}`, {
			method: "DELETE",
			accepted: [200, 204, 404, 410],
		});
	}

	/** Best-effort cleanup of a connection this manager created. */
	async function discard(id: string): Promise<void> {
		try {
			await deleteConnection(id);
		} catch {
			// the original error is primary; LARM expires unreleased connections
		}
	}

	async function claim(
		id: string,
		found: DecisionTarget,
	): Promise<{
		provider: ClaimedDecisionProvider;
		expiresAt: number;
	}> {
		const raw = await control.json(
			`/v1/agent-connections/${encodeURIComponent(id)}/claim`,
			{
				method: "POST",
				json: { format: "openai-provider-v1" },
			},
		);
		const parsed = claimSchema.safeParse(raw);
		if (
			!parsed.success ||
			parsed.data.id !== id ||
			parsed.data.status !== "ready"
		)
			throw new LarmControlError("larm_invalid_claim");
		const info = parsed.data.providers.find(
			(p) => p.name === found.provider.name,
		);
		if (!info || info.model !== found.provider.model)
			throw new LarmControlError("larm_claim_mismatch");
		// The provider token goes only to an endpoint on the Control host.
		const endpoint = assertProviderEndpoint(
			info.endpoint,
			control.origin,
			found.provider.endpoint,
		);
		let expiresAt = Date.parse(parsed.data.expiresAt);
		if (info.credential.expiresAt !== undefined) {
			const credentialExpiry = Date.parse(info.credential.expiresAt);
			if (Number.isFinite(credentialExpiry))
				expiresAt = Math.min(expiresAt, credentialExpiry);
		}
		if (
			!Number.isFinite(expiresAt) ||
			expiresAt < Date.now() + EXPIRY_MARGIN_MS
		)
			throw new LarmControlError("larm_expired");
		return {
			provider: {
				endpoint: endpoint.href,
				model: info.model,
				token: info.credential.token,
			},
			expiresAt,
		};
	}

	function scheduleRenew(current: Lease): void {
		clearTimeout(current.renewTimer);
		if (closed) return;
		const delay = Math.max(
			1000,
			(current.expiresAt - Date.now()) * RENEW_FRACTION,
		);
		current.renewTimer = setTimeout(() => {
			if (lease !== current || closed || connecting) return;
			const task = renew(current).finally(() => {
				if (connecting === task) connecting = undefined;
			});
			connecting = task;
			task.catch(() => {});
		}, delay);
		current.renewTimer.unref?.();
	}

	async function renew(current: Lease): Promise<Lease> {
		try {
			const found = target;
			if (!found) throw new LarmControlError("larm_renew_invalid");
			const raw = await control.json(
				`/v1/agent-connections/${encodeURIComponent(current.id)}/renew`,
				{
					method: "POST",
					json: { ttlSeconds: TTL_SECONDS },
					idempotencyKey: crypto.randomUUID(),
					accepted: [200, 201],
				},
			);
			const renewed = connectionSchema.safeParse(raw);
			if (
				!renewed.success ||
				renewed.data.id !== current.id ||
				renewed.data.status !== "ready"
			)
				throw new LarmControlError("larm_renew_invalid");
			const next = await claim(current.id, found);
			if (next.provider.model !== current.provider.model)
				throw new LarmControlError("larm_renew_claim_mismatch");
			current.provider = next.provider;
			current.expiresAt = next.expiresAt;
			scheduleRenew(current);
			return current;
		} catch (error) {
			// A lease that cannot be renewed is dropped; the next ask reconnects.
			clearTimeout(current.renewTimer);
			if (lease === current) lease = undefined;
			await discard(current.id);
			throw error;
		}
	}

	async function create(
		found: DecisionTarget,
		signal: AbortSignal | undefined,
	): Promise<z.infer<typeof connectionSchema>> {
		// One key per connect(): a retry after a timed-out POST returns the same connection.
		const idempotencyKey = crypto.randomUUID();
		const attempt = () =>
			control.json("/v1/agent-connections", {
				method: "POST",
				json: {
					profile: options.selector,
					client: options.clientId,
					audience: options.audience,
					providers: [found.provider.name],
					expectedCatalogRevision: found.catalogRevision,
				},
				idempotencyKey,
				accepted: [201, 202],
				...(signal ? { signal } : {}),
			});
		let raw: unknown;
		try {
			raw = await attempt();
		} catch (error) {
			if (
				!(error instanceof DOMException && error.name === "TimeoutError") ||
				closed
			)
				throw error;
			raw = await attempt();
		}
		const parsed = connectionSchema.safeParse(raw);
		if (!parsed.success) throw new LarmControlError("larm_invalid_connection");
		return parsed.data;
	}

	function verifyProfile(
		created: z.infer<typeof connectionSchema>,
		found: DecisionTarget,
	): void {
		const provider = created.providers.find(
			(p) => p.name === found.provider.name,
		);
		if (
			created.agentProfile !== found.profileId ||
			provider?.capability !== capability
		)
			throw new LarmControlError("larm_profile_mismatch");
	}

	async function connect(signal: AbortSignal | undefined): Promise<Lease> {
		const found =
			target ?? (target = await discoverTarget(control, capability, signal));
		let created = await create(found, signal);
		const id = created.id;
		try {
			verifyProfile(created, found);
			const deadline = Date.now() + readyTimeoutMs;
			const providerReady = (c: typeof created) => {
				const p = c.providers.find((item) => item.name === found.provider.name);
				return p?.readiness === "ready" && p.claimable === true;
			};
			for (;;) {
				if (TERMINAL.has(created.status))
					throw new LarmControlError(`larm_connection_${created.status}`);
				if (created.status === "ready" && providerReady(created)) break;
				if (Date.now() >= deadline)
					throw new LarmControlError("larm_ready_timeout");
				await defaultPause(pollMs, signal);
				const raw = await control.json(
					`/v1/agent-connections/${encodeURIComponent(id)}`,
					signal ? { signal } : {},
				);
				const next = connectionSchema.safeParse(raw);
				if (!next.success || next.data.id !== id)
					throw new LarmControlError("larm_invalid_connection");
				created = next.data;
				verifyProfile(created, found);
			}
			const claimed = await claim(id, found);
			if (closed) throw new LarmControlError("larm_lease_closed");
			const current: Lease = {
				id,
				provider: claimed.provider,
				expiresAt: claimed.expiresAt,
				renewTimer: undefined,
			};
			lease = current;
			scheduleRenew(current);
			return current;
		} catch (error) {
			await discard(id);
			throw error;
		}
	}

	/** Returns a usable lease, connecting lazily and sharing one in-flight connect/renew. */
	async function ensure(signal: AbortSignal): Promise<Lease> {
		if (closed) throw new LarmControlError("larm_lease_closed");
		if (lease && lease.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return lease;
		if (!connecting) {
			// An expired lease that was not renewed in time is replaced.
			const stale = lease;
			lease = undefined;
			if (stale) clearTimeout(stale.renewTimer);
			const task = (async () => {
				if (stale) await discard(stale.id);
				// Shared by all callers, so it is not bound to one caller's signal.
				return connect(undefined);
			})().finally(() => {
				if (connecting === task) connecting = undefined;
			});
			connecting = task;
		}
		return untilAborted(connecting, signal);
	}

	/** Drops a lease the server rejected so the next attempt connects afresh. */
	async function drop(rejected: Lease): Promise<void> {
		clearTimeout(rejected.renewTimer);
		target = undefined; // rediscover: the catalog revision may have moved
		if (lease === rejected) lease = undefined;
		if (lease === undefined || lease.id !== rejected.id)
			await discard(rejected.id);
	}

	const source: ProviderSource = {
		async withProvider(fn, signal) {
			for (let attempt = 0; ; attempt++) {
				const current = await ensure(signal);
				try {
					return await fn(current.provider);
				} catch (error) {
					const rejected =
						error instanceof LarmDecisionError &&
						(error.httpStatus === 401 || error.httpStatus === 403);
					if (!rejected || attempt > 0 || closed || signal.aborted) throw error;
					await drop(current);
				}
			}
		},
	};

	async function doRelease(): Promise<void> {
		closed = true;
		if (connecting) await connecting.catch(() => {});
		const current = lease;
		lease = undefined;
		if (current) {
			clearTimeout(current.renewTimer);
			await deleteConnection(current.id);
		}
	}

	return {
		judge: createDecisionJudge(source, {
			...(options.fetch ? { fetch: options.fetch } : {}),
			...(options.inferTimeoutMs ? { timeoutMs: options.inferTimeoutMs } : {}),
		}),
		status: () => ({
			connected: lease !== undefined,
			connectionId: lease?.id,
			expiresAt: lease?.expiresAt,
		}),
		release() {
			releasing ??= doRelease();
			return releasing;
		},
	};
}
