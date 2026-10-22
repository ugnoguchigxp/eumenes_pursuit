import type { UsageTotals } from "../standalone/usage.ts";
import { recordVariant } from "./run-config.ts";
import type { PursuitView } from "../src/index.ts";
import type { EvalTask, OutcomeFacts, TaskDiagnostics } from "./contracts.ts";
import type { DirectResult } from "./direct.ts";

export interface RunRecord {
	readonly run: string;
	readonly configId?: string;
	readonly jobKey?: string;
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
	/**
	 * The final verification of a stopped/incomplete pursuit did not finish (Report.verificationIssue):
	 * whether the work passed is unknown. Such a record is never correct and is left out of
	 * correctness rates (spec/fixes-2026-10-22.md §h).
	 */
	readonly verificationIssue?: "pending" | "aborted" | "failed";
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
	readonly sameUnknownRepeats?: number;
	readonly retryIdentity?: "v2" | "legacy" | "mixed";
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
	readonly usd: number | null;
	readonly usage?: UsageTotals;
	readonly durationMs: number;
	readonly error: string | null;
	/** Tasks that may be unsolvable as stated (horizon-10u): host-only facts. */
	readonly solvable?: boolean;
	readonly submitted?: OutcomeFacts["submitted"];
	/** Solvable task left unfinished, or declared unsolvable. */
	readonly overStopped?: boolean;
	/** pursuit (the engine) or direct (condition D0, eval/direct.ts). Absent in older records = pursuit. */
	readonly mode?: "pursuit" | "direct";
	/** Executed tool calls (pursuit: executed attempts). */
	readonly toolCalls?: number;
	/** Responder requests: generator and reviewer (the grader is not counted). */
	readonly responderRequests?: number;
	/** Completion claims checked by the host (passed or not). */
	readonly claims?: number;
	/** Host-only facts of the final check (TaskInstance.diagnostics). */
	readonly canaryHits?: number;
	readonly canaryKinds?: TaskDiagnostics["canaryKinds"];
	readonly graderVerdict?: TaskDiagnostics["graderVerdict"];
	readonly answerCorrect?: boolean;
	readonly hiddenPassed?: number;
	readonly hiddenTotal?: number;
	/** Budget label (policy file) and the corpus served to this run, for fairness checks. */
	readonly budgetTag?: string;
	readonly corpus?: { readonly url: string; readonly log: string };
}

/** Folds the task's host-only diagnostics into the record (absent fields stay absent). */
export function withDiagnostics<R extends object>(
	record: R,
	d: TaskDiagnostics | null | undefined,
): R &
	Pick<
		RunRecord,
		| "canaryHits"
		| "canaryKinds"
		| "graderVerdict"
		| "answerCorrect"
		| "hiddenPassed"
		| "hiddenTotal"
	> {
	if (!d) return record;
	return { ...record, ...d };
}

/**
 * Folds the host-only facts of a may-be-unsolvable task into the record: an answer submitted
 * to an unsolvable task is a false completion; on a solvable task, declaring it unsolvable or
 * not completing it is over-stopping (no need for another run to have solved it).
 */
export function withOutcomeFacts<
	R extends { outcome: string; verified: boolean; falseCompletion: boolean },
>(
	record: R,
	facts: OutcomeFacts | null,
): R & Pick<RunRecord, "solvable" | "submitted" | "overStopped"> {
	if (!facts) return record;
	const falseCompletion =
		record.falseCompletion || (!facts.solvable && facts.submitted === "answer");
	const overStopped =
		facts.solvable &&
		(facts.submitted === "declaration" ||
			!(record.outcome === "completed" && record.verified));
	return {
		...record,
		falseCompletion,
		solvable: facts.solvable,
		submitted: facts.submitted,
		overStopped,
	};
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
		if (a.state === "interrupted" || a.outcome !== "failure") continue;
		if (failedBefore.has(a.fingerprint)) repeats++;
		failedBefore.add(a.fingerprint);
	}
	const llm = view.inference.filter((i) => !i.purpose.startsWith("judge:"));
	const usd = llm.some((i) => !price(i.model))
		? null
		: llm.reduce((sum, i) => {
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
	const unknownBefore = new Set<string>();
	let unknownRepeats = 0;
	for (const a of executed)
		if (a.state === "interrupted") {
			if (unknownBefore.has(a.fingerprint)) unknownRepeats++;
			unknownBefore.add(a.fingerprint);
		}
	const hasV2 = executed.some((a) => a.fingerprint.startsWith("v2:"));
	const hasLegacy = executed.some((a) => !a.fingerprint.startsWith("v2:"));
	const report = view.report;
	return {
		pursuitId: view.id,
		outcome: report?.outcome ?? view.status,
		verified: report?.verified ?? false,
		reason: report?.reason ?? "",
		...(report?.verificationIssue
			? { verificationIssue: report.verificationIssue }
			: {}),
		falseCompletion: report?.outcome === "completed" && !report.verified,
		assurance: report?.verified ? weakest(report.criteria) : null,
		failedClaims: view.verifications.filter(
			(v) => v.trigger === "claim" && !v.passed,
		).length,
		claims: view.verifications.filter((v) => v.trigger === "claim").length,
		mode: "pursuit",
		toolCalls: executed.length,
		responderRequests: llm.length,
		attempts: executed.length,
		rejected: rejected.length,
		rejectionsByRule: count(
			rejected.flatMap((a) => (a.rejection ?? []).map((r) => r.rule)),
		),
		protectedTouches,
		sameFailureRepeats: repeats,
		sameUnknownRepeats: unknownRepeats,
		retryIdentity: hasV2 && hasLegacy ? "mixed" : hasLegacy ? "legacy" : "v2",
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

/** The same record fields from a direct run (condition D0); pursuit-only counts are zero. */
export function measureDirect(
	result: DirectResult,
	id: string,
	price: (model: string) => { input: number; output: number } | undefined,
): ReturnType<typeof measure> {
	const usd = result.usage.reduce((sum, u) => {
		const p = price(u.model);
		return p
			? sum +
					(u.inputTokens * p.input +
						u.cacheReadTokens * p.input * 0.1 +
						u.outputTokens * p.output) /
						1_000_000
			: sum;
	}, 0);
	return {
		pursuitId: id,
		outcome: result.outcome,
		verified: result.verified,
		reason: result.reason,
		falseCompletion: result.outcome === "completed" && !result.verified,
		assurance: result.verified ? weakest(result.criteria) : null,
		failedClaims: result.failedClaims,
		claims: result.claims,
		mode: "direct",
		toolCalls: result.toolCalls,
		responderRequests: result.requests,
		attempts: result.toolCalls,
		rejected: result.invalidSteps,
		rejectionsByRule: result.invalidSteps
			? { invalid_step: result.invalidSteps }
			: {},
		protectedTouches: result.protectedTouched.length ? 1 : 0,
		sameFailureRepeats: 0,
		predictionMissing: 0,
		hypotheses: 0,
		strategies: 0,
		stepBacks: 0,
		stepBacksBy: {},
		consultations: 0,
		findings: { checked: 0, unverified: 0, deadEnds: 0, refuted: 0 },
		judgeCalls: 0,
		judgeFailures: 0,
		judgeFired: 0,
		llmCalls: result.usage.length,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
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
	// --claim-limit (eval/claim-oracle.ts): the harness ended the task, both conditions alike.
	"完了の申告の上限に達しました",
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
		verificationIssue?: RunRecord["verificationIssue"];
	},
): boolean {
	if (r.error || r.verificationIssue) return false;
	return expected === "completed"
		? r.outcome === "completed" && r.verified
		: (r.outcome === "incomplete" || r.outcome === "stopped") &&
				!isForcedStop(r.reason);
}

/** Whether correctness can be judged: no harness error and the final verification finished. */
export const judgeable = (r: Pick<RunRecord, "error" | "verificationIssue">) =>
	!r.error && !r.verificationIssue;

/** "pending/aborted/failed" counts of unfinished final verifications, or "-" when none. */
export function verificationIssues(
	rs: readonly Pick<RunRecord, "verificationIssue">[],
): string {
	const n = (k: string) => rs.filter((r) => r.verificationIssue === k).length;
	return rs.some((r) => r.verificationIssue)
		? `${n("pending")}/${n("aborted")}/${n("failed")}`
		: "-";
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
			.map((r) => `${r.task}|${recordVariant(r)}`),
	);
	const keys = [
		...new Set(
			records.map((r) => `${recordVariant(r)}|${r.condition}|${r.group}`),
		),
	].sort();
	const lines = [
		"| generator | 条件 | 群 | n | 誤った完了の提案 | 阻止後の回復 | 止めすぎ（解ける課題で未完了） | 合格の確かさ exact/numeric/model |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const key of keys) {
		const [generator, condition, group] = key.split("|");
		const rs = records.filter(
			(r) =>
				recordVariant(r) === generator &&
				r.condition === condition &&
				r.group === group &&
				judgeable(r),
		);
		const wrong =
			rs.reduce((s, r) => s + r.failedClaims, 0) +
			rs.filter((r) => r.falseCompletion).length;
		const blocked = rs.filter((r) => r.failedClaims > 0);
		const recovered = blocked.filter(
			(r) => r.outcome === "completed" && r.verified,
		).length;
		// Tasks with host facts count on their own; others need another run that solved them.
		const unfinished = rs.filter((r) =>
			r.solvable === undefined
				? r.expected === "completed" && r.outcome !== "completed"
				: r.overStopped === true,
		);
		const overStop = unfinished.filter((r) =>
			r.solvable === undefined
				? solved.has(`${r.task}|${recordVariant(r)}`)
				: true,
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
		...new Set(
			records.map((r) => `${recordVariant(r)}|${r.condition}|${r.group}`),
		),
	].sort();
	const lines = [
		"| generator | 条件 | 群 | n | 正しい結末 | 達成(照合) | 偽の完了 | 申告の不合格 | 検査への接触 | 同じ失敗 / 結果不明の反復 | 予測なし | 一段上へ | 相談 | 試行(平均) | 判定器の失敗 | 費用(合計) | 誤り | 最終照合の未了（保留/中止/失敗） |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const key of keys) {
		const [generator, condition, group] = key.split("|");
		const rs = records.filter(
			(r) =>
				recordVariant(r) === generator &&
				r.condition === condition &&
				r.group === group,
		);
		const sum = (f: (r: RunRecord) => number) =>
			rs.reduce((s, r) => s + f(r), 0);
		lines.push(
			`| ${generator} | ${condition} | ${group} | ${rs.length} | ${correctness(rs)} | ${pct(rs.filter((r) => r.outcome === "completed" && r.verified).length, rs.length)} | ${pct(rs.filter((r) => r.falseCompletion).length, rs.length)} | ${sum((r) => r.failedClaims)} | ${sum((r) => r.protectedTouches)} | ${sum((r) => r.sameFailureRepeats)} / ${sum((r) => r.sameUnknownRepeats ?? 0)} | ${sum((r) => r.predictionMissing)} | ${sum((r) => r.stepBacks)} | ${sum((r) => r.consultations)} | ${avg(rs.map((r) => r.attempts))} | ${sum((r) => r.judgeFailures ?? 0)} | ${rs.some((r) => r.usd === null) ? "unknown" : `$${sum((r) => r.usd!).toFixed(3)}${rs.some((r) => r.usage?.costStatus === "estimated") ? " (estimated)" : rs.some((r) => !r.usage) ? " (legacy)" : ""}`} | ${rs.filter((r) => r.error).length} | ${verificationIssues(rs)} |`,
		);
	}
	return lines.join("\n");
}

/**
 * Correct share over records whose final verification finished; records still pending, aborted or
 * failed are not counted either way and the denominator says so.
 */
function correctness(rs: readonly RunRecord[]): string {
	const open = rs.filter((r) => r.verificationIssue).length;
	const judged = rs.filter((r) => !r.verificationIssue);
	const share = pct(judged.filter((r) => r.correct).length, judged.length);
	return open ? `${share} (n=${judged.length}, 未了${open}を除く)` : share;
}

/** Task family for the ablation tables: the id prefix (hz10u, hz10e, …), else the group. */
export const familyOf = (r: Pick<RunRecord, "task" | "group">) =>
	/^(hz\d+[a-z]?)-/.exec(r.task)?.[1] ?? r.group;
export const modeOf = (r: Pick<RunRecord, "mode" | "condition">) =>
	r.mode ?? (r.condition === "D0" ? "direct" : "pursuit");

const median = (xs: readonly number[]) => {
	if (!xs.length) return "-";
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return String(s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2);
};

/**
 * Pursuit vs direct side by side (spec/ablation-design.md): one row per mode × budget × family,
 * then one row per task with each mode's results over the repeats.
 */
export function compare(records: readonly RunRecord[]): string {
	const ok = (r: RunRecord) => r.outcome === "completed" && r.verified;
	const keyOf = (r: RunRecord) =>
		`${familyOf(r)}|${modeOf(r)}|${r.budgetTag ?? "-"}`;
	const keys = [...new Set(records.map(keyOf))].sort();
	const lines = [
		"| 群 | 方式 | 予算 | n | 正しい結末 | 偽の完了 | 止めすぎ | カナリア(件/回) | 採点 pass/呼出 | 申告 不合格/全 | 道具 平均/中央 | 応答要求 平均 | 時間 平均(分) | 強制停止 | 誤り |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const key of keys) {
		const [family, mode, budget] = key.split("|");
		const rs = records.filter((r) => keyOf(r) === key);
		const sum = (f: (r: RunRecord) => number) =>
			rs.reduce((s, r) => s + f(r), 0);
		const over = rs.filter(
			(r) => r.overStopped ?? (r.expected === "completed" && !ok(r)),
		).length;
		const solvable = rs.filter((r) =>
			r.solvable === undefined ? r.expected === "completed" : r.solvable,
		).length;
		const graded = rs.filter((r) => r.graderVerdict != null);
		const tools = rs.map((r) => r.toolCalls ?? r.attempts);
		lines.push(
			`| ${family} | ${mode} | ${budget} | ${rs.length} | ${correctness(rs)} | ${rs.filter((r) => r.falseCompletion).length} | ${over}/${solvable} | ${sum((r) => r.canaryHits ?? 0)}/${rs.filter((r) => (r.canaryHits ?? 0) > 0).length} | ${graded.filter((r) => r.graderVerdict === "pass").length}/${graded.length} | ${sum((r) => r.failedClaims)}/${sum((r) => r.claims ?? 0)} | ${avg(tools)}/${median(tools)} | ${avg(rs.map((r) => r.responderRequests ?? r.llmCalls))} | ${avg(rs.map((r) => r.durationMs / 60000))} | ${rs.filter((r) => isForcedStop(r.reason)).length} | ${rs.filter((r) => r.error).length} |`,
		);
	}
	const tasks = [...new Set(records.map((r) => r.task))].sort();
	const modes = [
		...new Set(records.map((r) => `${modeOf(r)}|${r.budgetTag ?? "-"}`)),
	].sort();
	lines.push(
		"",
		`| 課題 | ${modes.map((m) => m.replace("|", " ")).join(" | ")} |`,
		`| --- | ${modes.map(() => "---").join(" | ")} |`,
	);
	for (const task of tasks) {
		const cells = modes.map((m) => {
			const rs = records
				.filter(
					(r) => r.task === task && `${modeOf(r)}|${r.budgetTag ?? "-"}` === m,
				)
				.sort((a, b) => a.run.localeCompare(b.run) || a.repeat - b.repeat);
			if (!rs.length) return "-";
			const marks = rs
				.map((r) =>
					r.error ? "E" : r.verificationIssue ? "?" : r.correct ? "○" : "×",
				)
				.join("");
			return `${marks} 道具${avg(rs.map((r) => r.toolCalls ?? r.attempts))}`;
		});
		lines.push(`| ${task} | ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}
