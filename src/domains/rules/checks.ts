import type { Policy, ToolDescriptor } from "../../contracts/index.ts";
import type {
	AttemptRow,
	HypothesisRow,
	Prediction,
	PursuitView,
	Rejection,
} from "../ledger/types.ts";

export const executed = (attempt: AttemptRow) =>
	attempt.state === "settled" || attempt.state === "interrupted";

export function attemptsOf(view: PursuitView, hypothesisId: string) {
	return view.attempts.filter((a) => a.hypothesisId === hypothesisId);
}

/** Checks that hold in every condition: they keep the harness safe, not smart. */
export function invariantRejections(input: {
	tool: ToolDescriptor | undefined;
	toolName: string;
	inputError: string | null;
	grant: readonly string[];
}): Rejection[] {
	if (!input.tool)
		return [
			{ rule: "unknown_tool", detail: `道具 ${input.toolName} はありません` },
		];
	const out: Rejection[] = [];
	if (input.inputError)
		out.push({ rule: "invalid_input", detail: input.inputError });
	if (!input.grant.includes(input.tool.permission))
		out.push({
			rule: "permission",
			detail: `権限 ${input.tool.permission} は許可されていません。必要なら相談してください`,
		});
	return out;
}

/** The rule layer's pre-execution checks (plan §7). */
export function ruleRejections(input: {
	view: PursuitView;
	hypothesis: HypothesisRow;
	prediction: Prediction;
	whatChanged: string;
	fingerprint: string;
	sameConditions?: (attempt: AttemptRow) => boolean | null;
	policy: Policy;
	/** Also require what would refute the hypothesis (spec/verification-design.md §3). */
	falsifiable?: boolean;
}): Rejection[] {
	const out: Rejection[] = [];
	const expected = input.prediction.expectedObservation.trim();
	if (!expected)
		out.push({
			rule: "prediction_required",
			detail:
				"予測のない試行は受け付けません。観測される結果を先に書いてください",
		});
	else if (input.falsifiable) {
		const refutedIf = input.prediction.refutedIf?.trim() ?? "";
		if (!refutedIf || refutedIf === expected)
			out.push({
				rule: "prediction_not_falsifiable",
				detail:
					"refutedIf に、どんな観測が出たらこの仮説が誤りと分かるかを、予測とは別に具体的に書いてください",
			});
	}
	const used = attemptsOf(input.view, input.hypothesis.id).filter(executed);
	if (used.length >= input.hypothesis.budget)
		out.push({
			rule: "hypothesis_budget",
			detail: "この仮説の試行予算を使い切りました",
		});
	const priorFailures = input.view.attempts.filter(
		(a) =>
			executed(a) && (a.outcome === "failure" || a.state === "interrupted"),
	);
	const matches = priorFailures.map((a) =>
		input.sameConditions
			? input.sameConditions(a)
			: a.fingerprint === input.fingerprint,
	);
	if (matches.some((m) => m === null))
		out.push({
			rule: "retry_history_unavailable",
			detail:
				"以前の道具の同一性契約を確認できません。履歴を照合できる契約をホストで確認し、判断を見直してください",
		});
	const failedSame = matches.filter((m) => m === true).length;
	if (failedSame > 0) {
		if (!input.whatChanged.trim())
			out.push({
				rule: "same_failure",
				detail:
					"失敗または結果不明の試行と同じ条件です。前回から何が変わったか（whatChanged）がなければ繰り返せません",
			});
		else if (failedSame > input.policy.retry.sameFingerprintWithReason)
			out.push({
				rule: "same_failure_limit",
				detail: "同じ条件の失敗を繰り返しています。別の方法を考えてください",
			});
	}
	return out;
}

/** Rejected proposals since the last executed attempt of the hypothesis. */
export function rejectionsInRow(
	view: PursuitView,
	hypothesisId: string,
): number {
	let count = 0;
	for (const attempt of [...attemptsOf(view, hypothesisId)].reverse()) {
		if (attempt.state !== "rejected") break;
		count++;
	}
	return count;
}

export interface Signal {
	readonly code:
		| "consecutive_failures"
		| "mismatch_not_shrinking"
		| "scope_growth"
		| "revisits"
		| "protected_touch"
		| "goal_drift";
	readonly value: number;
	readonly threshold: number;
}

function trailing<T>(items: readonly T[], test: (item: T) => boolean): number {
	let count = 0;
	for (const item of [...items].reverse()) {
		if (!test(item)) break;
		count++;
	}
	return count;
}

/** Rows strictly ordered by increasing (or non-improving) values at the tail. */
function tailRun(
	values: readonly (number | null)[],
	worse: (a: number, b: number) => boolean,
) {
	let run = 0;
	for (let i = values.length - 1; i > 0; i--) {
		const previous = values[i - 1];
		const current = values[i];
		if (
			typeof previous !== "number" ||
			typeof current !== "number" ||
			!worse(previous, current)
		)
			break;
		run++;
	}
	return run;
}

/** Mechanically counted symptoms within one hypothesis (plan §7 兆候の検出). */
export function signals(
	view: PursuitView,
	hypothesisId: string,
	policy: Policy,
	changingTools: ReadonlySet<string>,
): Signal[] {
	const done = attemptsOf(view, hypothesisId).filter(
		(a) => a.state === "settled",
	);
	const limits = policy.signals;
	const out: Signal[] = [];
	const push = (code: Signal["code"], value: number, threshold: number) => {
		if (value >= threshold) out.push({ code, value, threshold });
	};
	push(
		"consecutive_failures",
		trailing(done, (a) => a.outcome === "failure"),
		limits.consecutiveFailures,
	);
	const matches = done.map((a) => a.features?.match ?? null);
	const mismatch = trailing(
		matches,
		(m) => m !== null && m < policy.judge.mismatchBelow,
	);
	push(
		"mismatch_not_shrinking",
		mismatch >= 2 ? tailRun(matches.slice(-mismatch), (a, b) => b <= a) + 1 : 0,
		limits.mismatchNotShrinking,
	);
	push(
		"scope_growth",
		scopeGrowth(done, changingTools, limits.scratchDirs),
		limits.scopeGrowth,
	);
	push("revisits", revisits(done, changingTools), limits.revisits);
	push(
		"protected_touch",
		done.filter((a) => (a.features?.protectedTouched.length ?? 0) > 0).length,
		limits.protectedTouches,
	);
	const progress = done.map((a) => a.features?.progress ?? null);
	push(
		"goal_drift",
		tailRun(progress, (a, b) => b < a),
		limits.goalDrift,
	);
	return out;
}

/** Whether a workspace path is scratch work (any path segment is a scratch directory). */
export function isScratchPath(path: string, scratchDirs: readonly string[]) {
	return path.split("/").some((segment) => scratchDirs.includes(segment));
}

/**
 * Trailing run of workspace-changing attempts that each changed task files not changed before
 * in the hypothesis (spec/fixes-2026-10-22.md §d). `filesTouched` is cumulative since the
 * hypothesis checkpoint, so an attempt's new files are those absent from the previous attempt's
 * set. Read-only attempts neither extend nor break the run; a changing attempt that adds no new
 * task file breaks it. Scratch paths are never task files.
 */
function scopeGrowth(
	done: readonly AttemptRow[],
	changingTools: ReadonlySet<string>,
	scratchDirs: readonly string[],
): number {
	let previous = new Set<string>();
	const grew: boolean[] = [];
	for (const attempt of done) {
		const files = new Set(
			(attempt.features?.filesTouched ?? []).filter(
				(f) => !isScratchPath(f, scratchDirs),
			),
		);
		const added = [...files].some((f) => !previous.has(f));
		if (changingTools.has(attempt.tool) || added) grew.push(added);
		previous = files;
	}
	return trailing(grew, (g) => g);
}

/**
 * Changing a location again after other attempts moved elsewhere.
 * A location is the `path` input of an attempt that changed the workspace.
 */
function revisits(
	done: readonly AttemptRow[],
	changingTools: ReadonlySet<string>,
): number {
	const lastSeen = new Map<string, number>();
	let count = 0;
	done
		.filter((a) => changingTools.has(a.tool))
		.forEach((attempt, index) => {
			const path = attempt.input.path;
			if (typeof path !== "string") return;
			const seen = lastSeen.get(path);
			if (seen !== undefined && seen < index - 1) count++;
			lastSeen.set(path, index);
		});
	return count;
}

export type BudgetStop = "attempts" | "wall_time" | "transitions";

export function pursuitBudgetExceeded(
	view: PursuitView,
	now: number,
): BudgetStop | null {
	const budget = view.input.policy.budget;
	if (view.attempts.filter(executed).length >= budget.attempts)
		return "attempts";
	if (remainingWallMs(view, now) <= 0) return "wall_time";
	if (view.revision >= budget.transitions) return "transitions";
	return null;
}

/** Was the attempt's observation what the prediction said? */
export function attemptOutcome(
	prediction: Prediction,
	status: "ok" | "error",
	match: number | null,
	policy: Policy,
): "success" | "failure" {
	if (prediction.expectedStatus !== status) return "failure";
	if (match !== null && match < policy.judge.mismatchBelow) return "failure";
	return "success";
}

/** Consultation waits pause the active wall budget. Host supplies the clock. */
export function remainingWallMs(view: PursuitView, now: number): number {
	const waiting = view.consultations.reduce(
		(sum, c) => sum + ((c.answeredAt ?? now) - c.askedAt),
		0,
	);
	return Math.max(
		0,
		view.input.policy.budget.wallMs - (now - view.startedAt - waiting),
	);
}

/**
 * Finding numbers (F3) a proposal cites that the ledger does not hold (spec/fixes-2026-10-22.md
 * §e). Looks at the structured references (uses, refute) and at F-numbers in the message, the
 * self-assessment and the acceptance check: the ids are the host's own, so this is a structural
 * check, not a reading of the text.
 */
export function unrecordedFindingRefs(
	view: PursuitView,
	proposal: {
		message?: string;
		uses?: readonly string[];
		refute?: readonly { id: string }[];
		assessment?: readonly { evidence: string; next: string }[];
		acceptanceCheck?: readonly { where: string }[];
	},
): string[] {
	const known = new Set(view.findings.map((f) => f.seq));
	const cited = new Set<number>();
	const scan = (text: string) => {
		for (const m of text.matchAll(/(?<![A-Za-z0-9])F(\d{1,4})(?![A-Za-z0-9])/g))
			cited.add(Number(m[1]));
	};
	for (const id of [
		...(proposal.uses ?? []),
		...(proposal.refute ?? []).map((r) => r.id),
	]) {
		const seq = /^\s*F?(\d+)\s*$/i.exec(id)?.[1];
		if (seq) cited.add(Number(seq));
		else scan(id);
	}
	scan(proposal.message ?? "");
	for (const a of proposal.assessment ?? []) scan(`${a.evidence}\n${a.next}`);
	for (const c of proposal.acceptanceCheck ?? []) scan(c.where);
	return [...cited]
		.filter((seq) => !known.has(seq))
		.sort((a, b) => a - b)
		.map((seq) => `F${seq}`);
}
