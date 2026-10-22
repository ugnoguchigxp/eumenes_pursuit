/** Host-owned billing records; no prompts, credentials or private rubric contents. */
export interface UsageScope {
	readonly runId: string;
	readonly configId: string;
	readonly jobId: string;
	pursuitId: string | null;
}
export interface UsageCall {
	readonly callId: string;
	readonly requestedModel: string;
	readonly latencyMs: number;
	readonly status: "response" | "ok" | "invalid" | "error";
	readonly provider?: "claude" | "file" | "larm";
}
export interface UsageEvent extends UsageCall {
	readonly scope: UsageScope | null;
	readonly role: string;
	readonly servedModel: string | null;
	readonly reportedModel?: string;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cacheReadTokens: number | null;
	readonly cacheWriteTokens: number | null;
	readonly pricingVersion: string;
	readonly costStatus: "known" | "estimated" | "unknown";
	readonly usd: number | null;
}
export interface UsageTotals {
	readonly calls: number;
	readonly knownUsd: number;
	readonly unknownCostCalls: number;
	readonly unknownUsageCalls: number;
	readonly estimatedTokenCalls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly usd: number | null;
	readonly costStatus: "known" | "estimated" | "unknown";
	readonly byRole: Readonly<
		Record<string, { calls: number; usd: number | null }>
	>;
	readonly events: readonly UsageEvent[];
}
export function totalUsage(events: readonly UsageEvent[]): UsageTotals {
	const byRole: Record<string, { calls: number; usd: number | null }> = {};
	for (const e of events) {
		const prior = byRole[e.role] ?? { calls: 0, usd: 0 };
		byRole[e.role] = {
			calls: prior.calls + 1,
			usd: prior.usd === null || e.usd === null ? null : prior.usd + e.usd,
		};
	}
	return {
		calls: events.length,
		knownUsd: events.reduce((n, e) => n + (e.usd ?? 0), 0),
		unknownCostCalls: events.filter((e) => e.usd === null).length,
		unknownUsageCalls: events.filter(
			(e) => e.inputTokens === null || e.outputTokens === null,
		).length,
		estimatedTokenCalls: events.filter((e) => e.provider === "file").length,
		inputTokens: events.reduce(
			(n, e) =>
				n +
				(e.inputTokens ?? 0) +
				(e.cacheReadTokens ?? 0) +
				(e.cacheWriteTokens ?? 0),
			0,
		),
		outputTokens: events.reduce((n, e) => n + (e.outputTokens ?? 0), 0),
		usd: events.some((e) => e.usd === null)
			? null
			: events.reduce((n, e) => n + e.usd!, 0),
		costStatus: events.some((e) => e.costStatus === "unknown")
			? "unknown"
			: events.some((e) => e.costStatus === "estimated")
				? "estimated"
				: "known",
		byRole,
		events,
	};
}
