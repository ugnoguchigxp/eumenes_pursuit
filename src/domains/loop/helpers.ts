import type {
	DecidedBy,
	DecisionKind,
	JsonObject,
	WorkspaceChanges,
} from "../../contracts/index.ts";
import type { Review } from "../generation/prompts.ts";
import { findQuestionSet } from "../judge/question-sets.ts";
import type { PursuitView } from "../ledger/types.ts";
import { attemptsOf } from "../rules/checks.ts";
import { refutationHeld } from "../rules/refutation.ts";

/** Consecutive settled attempts, ending at `attemptId`, whose trajectory judgement alarmed. */
export function trajectoryStreak(view: PursuitView, attemptId: string): number {
	const trajectoryIds = new Set(
		findQuestionSet(view.input.conditions.questionSet)
			.questions.filter((q) => q.role.kind === "trajectory")
			.map((q) => q.id),
	);
	const attempt = view.attempts.find((a) => a.id === attemptId);
	if (!attempt) return 0;
	const settled = view.attempts.filter(
		(a) => a.hypothesisId === attempt.hypothesisId && a.state === "settled",
	);
	let streak = 0;
	for (const a of [...settled].reverse()) {
		const alarmed = view.judgements.some(
			(j) =>
				j.attemptId === a.id &&
				trajectoryIds.has(j.questionId) &&
				j.fired &&
				j.usable,
		);
		if (!alarmed) break;
		streak++;
	}
	return streak;
}

/**
 * Step-back causes that are evidence the workspace was damaged, not merely unfinished or wide:
 * an existing check or test was changed, or the judged progress fell attempt after attempt
 * (spec/fixes-2026-10-22-b.md §1). scope_growth and revisits describe how the work went, not
 * damage, so policy.restore "protective" never reverts on them.
 */
const damageSignals = new Set(["protected_touch", "goal_drift"]);
export function damaging(basis: JsonObject | undefined): boolean {
	if (!basis) return false;
	if (basis.stage === "pre") return true;
	const signals = Array.isArray(basis.signals) ? basis.signals : [];
	return signals.some((s) => typeof s === "string" && damageSignals.has(s));
}

/**
 * Whether a hypothesis is being left because it held, not because it failed: the generator
 * stepped back on its own (no rule, guard or signal forced it), and its last executed attempt
 * matched the predicted status with a machine-checkable refutedIf that did not hold. Such a
 * hypothesis is not recorded as a dead end (spec/fixes-2026-10-22-b.md §3).
 */
export function hypothesisHeld(
	view: PursuitView,
	hypothesisId: string,
	lastStepBack: { decidedBy: string; basis: JsonObject } | undefined,
	fired: readonly { code: string }[],
): boolean {
	if (!lastStepBack || lastStepBack.decidedBy !== "generator" || fired.length)
		return false;
	const last = attemptsOf(view, hypothesisId)
		.filter((a) => a.state === "settled" && a.observation)
		.at(-1);
	if (!last || last.outcome !== "success") return false;
	if (last.observation!.status !== last.prediction.expectedStatus) return false;
	return refutationHeld(last.prediction.refutedIf, last.observation) === false;
}

export const decidedByLabel: Record<DecidedBy, string> = {
	rules: "規則",
	judge: "判定者",
	review: "見直し役",
	human: "人",
	generator: "生成器",
};

export const budgetReasons = {
	attempts: "追求全体の試行予算を使い切りました",
	wall_time: "追求全体の時間予算を使い切りました",
	transitions: "追求全体の手順数の上限に達しました",
} as const;

export const noChanges: WorkspaceChanges = {
	filesTouched: [],
	linesChanged: 0,
	protectedTouched: [],
};

/** A workspace path as the tools name it ("./a" and "a" are the same file). */
export const normalPath = (path: string) => path.replace(/^(\.\/)+/, "");

export const reviewKinds: Readonly<Record<Review["decision"], DecisionKind>> = {
	continue_strategy: "change_hypothesis",
	change_strategy: "revise_strategy",
	consult: "consult",
	stop: "stop",
};

export class WallTimeExpired extends Error {}

/** F numbers cited in a text, by the same pattern as the citation check (checks.ts). */
/**
 * fixes g §10: a refutation reason that cites F numbers is checked against them. A number not in the
 * ledger, the refuted finding itself, or a cited statement sharing no word or number with the reason
 * gets a note. Heuristic (shared tokens only): a note does not mean the reason is wrong.
 */
export function citationNote(
	reason: string,
	refuted: number,
	findings: readonly { seq: number; statement: string }[],
): string {
	const notes: string[] = [];
	const body = reason.replace(/(?<![A-Za-z0-9])F\d{1,4}(?![A-Za-z0-9])/g, " ");
	const tokens = [
		...(body.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_.]{2,}/g) ?? []),
		...(
			body.match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) ?? []
		).flatMap((run) => [...run].slice(0, -1).map((c, i) => c + run[i + 1])),
	];
	for (const n of findingRefs(reason)) {
		const cited = findings.find((f) => f.seq === n);
		if (!cited) notes.push(`F${n} は台帳にない番号`);
		else if (n === refuted) notes.push(`F${n} は反証する知見そのもの`);
		else if (!tokens.some((t) => cited.statement.includes(t)))
			notes.push(`F${n} の本文に、理由の語や数値が見当たらない`);
	}
	return notes.length
		? `［注: ${notes.join("。")}（ホストの簡易な照合。誤りとは限らない）］`
		: "";
}

export function findingRefs(text: string): number[] {
	return [
		...new Set(
			[...text.matchAll(/(?<![A-Za-z0-9])F(\d{1,4})(?![A-Za-z0-9])/g)].map(
				(m) => Number(m[1]),
			),
		),
	];
}

/** Up to `max` characters, cut after the last full sentence when there is one (fixes-2026-10-22-f §B). */
export function sentenceClip(text: string, max: number): string {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	const head = t.slice(0, max);
	const end = head.lastIndexOf("。");
	return end >= max / 3 ? head.slice(0, end + 1) : `${head}…`;
}
