/**
 * Long-horizon measures (spec/long-horizon-design.md, horizon-1), computed from the ledger only.
 * Pure functions: the same view always gives the same numbers.
 */
import type { PursuitView } from "../src/index.ts";
import { isForcedStop, type RunRecord } from "./metrics.ts";

type View = Pick<
	PursuitView,
	| "input"
	| "strategies"
	| "attempts"
	| "decisions"
	| "consultations"
	| "revision"
	| "startedAt"
	| "updatedAt"
>;

/** How the pursuit ended, as a stable class rather than free text. */
export function ending(
	r: Pick<RunRecord, "error" | "outcome" | "verified" | "reason"> &
		Partial<Pick<RunRecord, "verificationIssue">>,
	v: Pick<PursuitView, "decisions"> | undefined,
): string {
	if (r.error) return "harness_error";
	// Unknown whether the work passed: kept apart from every judged ending.
	if (r.verificationIssue) return `verification_${r.verificationIssue}`;
	if (r.outcome === "completed")
		return r.verified ? "verified" : "claimed_unverified";
	if (isForcedStop(r.reason))
		return r.reason.includes("試行") ? "budget_attempts" : "forced_stop";
	if (r.outcome === "incomplete") return "gave_up";
	return `stopped_by_${v?.decisions.at(-1)?.decidedBy ?? "unknown"}`;
}

/** Which budget, if any, the pursuit ran into (finer than `ending` for forced stops). */
export function budgetStop(reason: string): string | null {
	if (reason === "追求全体の試行予算を使い切りました") return "attempts";
	if (reason === "追求全体の時間予算を使い切りました") return "wall_time";
	if (reason === "追求全体の手順数の上限に達しました") return "transitions";
	if (reason === "評価の手順数の上限") return "eval_max_steps";
	return null;
}

export interface BudgetUse {
	/** Each share is used / budget, so 1 means the budget was exhausted. */
	readonly attempts: number;
	readonly strategies: number;
	readonly stepBacks: number;
	readonly transitions: number;
	/** Wall time without time spent waiting for consultation answers. */
	readonly wall: number;
	/** The largest share: how close the pursuit came to any limit. */
	readonly max: number;
}

const executed = (a: View["attempts"][number]) =>
	a.state === "settled" || a.state === "interrupted";

/** Share of each budget the pursuit used, as the rules layer counts it (rules/checks.ts). */
export function budgetUse(v: View): BudgetUse {
	const b = v.input.policy.budget;
	const waiting = v.consultations.reduce(
		(sum, c) => sum + ((c.answeredAt ?? v.updatedAt) - c.askedAt),
		0,
	);
	const share = (used: number, limit: number) =>
		Math.min(1, Math.max(0, used / limit));
	const use = {
		attempts: share(v.attempts.filter(executed).length, b.attempts),
		strategies: share(v.strategies.length, b.strategies),
		stepBacks: share(
			v.decisions.filter((d) => d.kind === "step_back").length,
			b.stepBacks,
		),
		transitions: share(v.revision, b.transitions),
		wall: share(v.updatedAt - v.startedAt - waiting, b.wallMs),
	};
	return { ...use, max: Math.max(...Object.values(use)) };
}

/** Share of a strategy's parts it last assessed as done; null without parts or assessment. */
export function doneShare(s: View["strategies"][number]): number | null {
	if (!s.parts.length || !s.assessment) return null;
	const done = new Set(
		s.assessment.filter((a) => a.status === "done").map((a) => a.part),
	);
	return done.size / s.parts.length;
}

const mean = (xs: readonly number[]) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export interface Progress {
	/** Mean done-share of the strategies in the first and the second half (by seq). */
	readonly earlier: number | null;
	readonly later: number | null;
	/** later − earlier; positive means later strategies got further. Null below two assessed strategies. */
	readonly gain: number | null;
}

/**
 * Did later strategies get further than earlier ones? Strategies are split at the
 * middle by order (an odd one out goes to the later half); only assessed ones count.
 */
export function progress(v: Pick<View, "strategies">): Progress {
	const ordered = [...v.strategies].sort((a, b) => a.seq - b.seq);
	const half = Math.floor(ordered.length / 2);
	const shares = (xs: typeof ordered) =>
		xs.map(doneShare).filter((x): x is number => x !== null);
	const earlier = mean(shares(ordered.slice(0, half)));
	const later = mean(shares(ordered.slice(half)));
	return {
		earlier,
		later,
		gain: earlier === null || later === null ? null : later - earlier,
	};
}

/** Character bigrams after removing whitespace; works for Japanese text without a tokenizer. */
function bigrams(text: string): Set<string> {
	const s = text.replace(/\s+/g, "").toLowerCase();
	const out = new Set<string>();
	for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
	return out;
}

/** Jaccard similarity of character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
	const x = bigrams(a);
	const y = bigrams(b);
	if (!x.size && !y.size) return 1;
	let common = 0;
	for (const g of x) if (y.has(g)) common++;
	return common / (x.size + y.size - common);
}

/**
 * A later strategy whose text is at least this similar to an earlier one counts as
 * a return to the same construction. Analysis-only constant (not a policy value).
 */
export const returnSimilarity = 0.5;

export interface Returns {
	/** Per strategy after the first: the highest similarity to any earlier strategy. */
	readonly maxSimilarity: readonly number[];
	readonly count: number;
}

export function returns(v: Pick<View, "strategies">): Returns {
	const ordered = [...v.strategies].sort((a, b) => a.seq - b.seq);
	const maxSimilarity = ordered
		.slice(1)
		.map((s, i) =>
			Math.max(
				...ordered.slice(0, i + 1).map((e) => similarity(s.body, e.body)),
			),
		);
	return {
		maxSimilarity,
		count: maxSimilarity.filter((x) => x >= returnSimilarity).length,
	};
}

export interface HorizonRow {
	readonly ending: string;
	readonly budgetStop: string | null;
	readonly use: BudgetUse;
	readonly progress: Progress;
	readonly returns: Returns;
}

export function horizonRow(r: RunRecord, v: View): HorizonRow {
	return {
		ending: ending(r, v),
		budgetStop: budgetStop(r.reason),
		use: budgetUse(v),
		progress: progress(v),
		returns: returns(v),
	};
}
