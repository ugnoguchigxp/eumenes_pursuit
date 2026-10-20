import type { PursuitView } from "../src/index.ts";
import type { EvalTask } from "./contracts.ts";

export interface RunRecord {
	readonly run: string;
	readonly task: string;
	readonly group: EvalTask["group"];
	readonly condition: string;
	readonly generator: string;
	readonly level: number | null;
	readonly repeat: number;
	readonly pursuitId: string;
	readonly expected: EvalTask["expected"];
	readonly outcome: string;
	readonly verified: boolean;
	readonly reason: string;
	/** Matches the task's correct terminal outcome. */
	readonly correct: boolean;
	readonly falseCompletion: boolean;
	/** Weakest assurance among the criteria of a verified completion; null otherwise. */
	readonly assurance?: "exact" | "numeric" | "model" | null;
	readonly failedClaims: number;
	readonly attempts: number;
	readonly rejected: number;
	readonly rejectionsByRule: Record<string, number>;
	readonly protectedTouches: number;
	readonly sameFailureRepeats: number;
	readonly predictionMissing: number;
	readonly hypotheses: number;
	readonly strategies: number;
	readonly stepBacks: number;
	readonly stepBacksBy: Record<string, number>;
	readonly consultations: number;
	readonly judgeCalls: number;
	/** Findings recorded, by kind/assurance (spec/findings-design.md). */
	readonly findings?: {
		readonly checked: number;
		readonly unverified: number;
		readonly deadEnds: number;
		readonly refuted: number;
	};
	/** d1 requests that failed; the guards were absent for those stages. */
	readonly judgeFailures: number;
	readonly judgeFired: number;
	readonly llmCalls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly usd: number;
	readonly durationMs: number;
	readonly error: string | null;
}

const count = (items: readonly string[]) =>
	items.reduce<Record<string, number>>((acc, key) => {
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});

/** Facts from the ledger only; never from the generator's own report. */
export function measure(
	view: PursuitView,
	price: (model: string) => { input: number; output: number } | undefined,
): Omit<
	RunRecord,
	| "run"
	| "task"
	| "group"
	| "condition"
	| "generator"
	| "level"
	| "repeat"
	| "expected"
	| "correct"
	| "durationMs"
	| "error"
> {
	const executed = view.attempts.filter(
		(a) => a.state === "settled" || a.state === "interrupted",
	);
	const rejected = view.attempts.filter((a) => a.state === "rejected");
	const failedBefore = new Set<string>();
	let repeats = 0;
	for (const a of executed) {
		if (a.outcome !== "failure") continue;
		if (failedBefore.has(a.fingerprint)) repeats++;
		failedBefore.add(a.fingerprint);
	}
	const llm = view.inference.filter((i) => !i.purpose.startsWith("judge:"));
	const usd = llm.reduce((sum, i) => {
		const p = price(i.model);
		return p
			? sum +
					(i.inputTokens * p.input +
						i.cacheReadTokens * p.input * 0.1 +
						i.outputTokens * p.output) /
						1_000_000
			: sum;
	}, 0);
	// Count a protected touch once, on the attempt where it first appears.
	let protectedTouches = 0;
	const seen = new Map<string, number>();
	for (const a of executed) {
		const before = seen.get(a.hypothesisId) ?? 0;
		const now = a.features?.protectedTouched.length ?? 0;
		if (now > before) protectedTouches++;
		seen.set(a.hypothesisId, Math.max(before, now));
	}
	const report = view.report;
	return {
		pursuitId: view.id,
		outcome: report?.outcome ?? view.status,
		verified: report?.verified ?? false,
		reason: report?.reason ?? "",
		falseCompletion: report?.outcome === "completed" && !report.verified,
		assurance: report?.verified ? weakest(report.criteria) : null,
		failedClaims: view.verifications.filter(
			(v) => v.trigger === "claim" && !v.passed,
		).length,
		attempts: executed.length,
		rejected: rejected.length,
		rejectionsByRule: count(
			rejected.flatMap((a) => (a.rejection ?? []).map((r) => r.rule)),
		),
		protectedTouches,
		sameFailureRepeats: repeats,
		predictionMissing: view.attempts.filter(
			(a) =>
				a.tool !== "done" &&
				a.tool !== "(invalid)" &&
				!a.prediction.expectedObservation.trim(),
		).length,
		hypotheses: view.hypotheses.length,
		strategies: view.strategies.length,
		stepBacks: view.decisions.filter((d) => d.kind === "step_back").length,
		stepBacksBy: count(
			view.decisions
				.filter((d) => d.kind === "step_back")
				.map((d) => d.decidedBy),
		),
		consultations: view.consultations.length,
		findings: {
			checked: view.findings.filter(
				(f) => f.kind !== "dead_end" && f.assurance !== "unverified",
			).length,
			unverified: view.findings.filter((f) => f.assurance === "unverified")
				.length,
			deadEnds: view.findings.filter((f) => f.kind === "dead_end").length,
			refuted: view.findings.filter((f) => f.status === "refuted").length,
		},
		judgeCalls: view.inference.filter(
			(i) => i.purpose.startsWith("judge:") && !i.purpose.includes(":failed"),
		).length,
		judgeFailures: view.inference.filter((i) => i.purpose.includes(":failed"))
			.length,
		judgeFired: view.judgements.filter(
			(j) => j.fired && j.usable && j.stage !== "review",
		).length,
		llmCalls: llm.length,
		inputTokens: llm.reduce((s, i) => s + i.inputTokens, 0),
		outputTokens: llm.reduce((s, i) => s + i.outputTokens, 0),
		usd,
	};
}

/** Stops forced by budgets, caps, broken model output or the harness: not a choice the pursuit made. */
const forcedStops = new Set([
	"追求全体の試行予算を使い切りました",
	"追求全体の時間予算を使い切りました",
	"追求全体の手順数の上限に達しました",
	"評価の手順数の上限",
	"相談が3回を超えました",
]);
export const isForcedStop = (reason: string) =>
	forcedStops.has(reason) ||
	reason.startsWith("LLM の出力を受け取れませんでした");

export function isCorrect(
	expected: EvalTask["expected"],
	r: {
		outcome: string;
		verified: boolean;
		reason: string;
		error: string | null;
	},
): boolean {
	if (r.error) return false;
	return expected === "completed"
		? r.outcome === "completed" && r.verified
		: (r.outcome === "incomplete" || r.outcome === "stopped") &&
				!isForcedStop(r.reason);
}

const pct = (n: number, d: number) =>
	d ? `${Math.round((n / d) * 100)}%` : "-";
const avg = (xs: readonly number[]) =>
	xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-";

const rank = { exact: 0, numeric: 1, model: 2 } as const;
function weakest(
	criteria: readonly { assurance?: "exact" | "numeric" | "model" }[],
): "exact" | "numeric" | "model" {
	let out: "exact" | "numeric" | "model" = "exact";
	for (const c of criteria)
		if (rank[c.assurance ?? "exact"] > rank[out]) out = c.assurance ?? "exact";
	return out;
}

/**
 * Detection apart from enforcement: wrong completion proposals (blocked claims,
 * plus unverified completions that slipped through), recovery after a block, and
 * over-stopping on tasks that the same variant solved in some other run.
 */
export function detection(records: readonly RunRecord[]): string {
	const solved = new Set(
		records
			.filter((r) => r.outcome === "completed" && r.verified && !r.error)
			.map((r) => `${r.task}|${r.generator}`),
	);
	const keys = [
		...new Set(records.map((r) => `${r.generator}|${r.condition}|${r.group}`)),
	].sort();
	const lines = [
		"| generator | 条件 | 群 | n | 誤った完了の提案 | 阻止後の回復 | 止めすぎ（解ける課題で未完了） | 合格の確かさ exact/numeric/model |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const key of keys) {
		const [generator, condition, group] = key.split("|");
		const rs = records.filter(
			(r) =>
				r.generator === generator &&
				r.condition === condition &&
				r.group === group &&
				!r.error,
		);
		const wrong =
			rs.reduce((s, r) => s + r.failedClaims, 0) +
			rs.filter((r) => r.falseCompletion).length;
		const blocked = rs.filter((r) => r.failedClaims > 0);
		const recovered = blocked.filter(
			(r) => r.outcome === "completed" && r.verified,
		).length;
		const unfinished = rs.filter(
			(r) => r.expected === "completed" && r.outcome !== "completed",
		);
		const overStop = unfinished.filter((r) =>
			solved.has(`${r.task}|${r.generator}`),
		).length;
		const verified = rs.filter((r) => r.verified && r.outcome === "completed");
		const by = (a: string) => verified.filter((r) => r.assurance === a).length;
		lines.push(
			`| ${generator} | ${condition} | ${group} | ${rs.length} | ${wrong} | ${recovered}/${blocked.length} | ${overStop}/${unfinished.length} | ${by("exact")}/${by("numeric")}/${by("model")} |`,
		);
	}
	return lines.join("\n");
}

/** One row per condition × group. Plan §12. */
export function summarize(records: readonly RunRecord[]): string {
	const keys = [
		...new Set(records.map((r) => `${r.generator}|${r.condition}|${r.group}`)),
	].sort();
	const lines = [
		"| generator | 条件 | 群 | n | 正しい結末 | 達成(照合) | 偽の完了 | 申告の不合格 | 検査への接触 | 同じ失敗の反復 | 予測なし | 一段上へ | 相談 | 試行(平均) | 判定器の失敗 | 費用(合計) | 誤り |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const key of keys) {
		const [generator, condition, group] = key.split("|");
		const rs = records.filter(
			(r) =>
				r.generator === generator &&
				r.condition === condition &&
				r.group === group,
		);
		const sum = (f: (r: RunRecord) => number) =>
			rs.reduce((s, r) => s + f(r), 0);
		lines.push(
			`| ${generator} | ${condition} | ${group} | ${rs.length} | ${pct(rs.filter((r) => r.correct).length, rs.length)} | ${pct(rs.filter((r) => r.outcome === "completed" && r.verified).length, rs.length)} | ${pct(rs.filter((r) => r.falseCompletion).length, rs.length)} | ${sum((r) => r.failedClaims)} | ${sum((r) => r.protectedTouches)} | ${sum((r) => r.sameFailureRepeats)} | ${sum((r) => r.predictionMissing)} | ${sum((r) => r.stepBacks)} | ${sum((r) => r.consultations)} | ${avg(rs.map((r) => r.attempts))} | ${sum((r) => r.judgeFailures ?? 0)} | $${sum((r) => r.usd).toFixed(3)} | ${rs.filter((r) => r.error).length} |`,
		);
	}
	return lines.join("\n");
}
