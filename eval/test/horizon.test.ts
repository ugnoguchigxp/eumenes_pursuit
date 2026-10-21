import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { policySchema } from "../../src/index.ts";
import { conditionsFor } from "../conditions.ts";
import {
	budgetStop,
	budgetUse,
	doneShare,
	ending,
	horizonRow,
	progress,
	returns,
	similarity,
} from "../horizon.ts";
import type { RunRecord } from "../metrics.ts";

const root = resolve(import.meta.dir, "../..");
const policy = (v: number) =>
	policySchema.parse(
		JSON.parse(readFileSync(resolve(root, `config/policy.v${v}.json`), "utf8")),
	);

type Strategy = Parameters<typeof doneShare>[0];
const strategy = (
	seq: number,
	body: string,
	parts: number,
	done: number[] | null,
): Strategy => ({
	id: `s${seq}`,
	seq,
	body,
	rationale: "",
	alternatives: [],
	parts: Array.from({ length: parts }, (_, i) => `part ${i + 1}`),
	assessment: done
		? Array.from({ length: parts }, (_, i) => ({
				part: i + 1,
				status: done.includes(i + 1) ? ("done" as const) : ("blocked" as const),
				evidence: "",
				next: "",
			}))
		: null,
	status: "closed",
	closeReason: null,
	previousId: null,
});

const attempt = (state: "settled" | "rejected" | "interrupted") =>
	({ state }) as Parameters<typeof budgetUse>[0]["attempts"][number];

function view(over: Partial<Parameters<typeof budgetUse>[0]> = {}) {
	return {
		input: { policy: policy(5) } as Parameters<typeof budgetUse>[0]["input"],
		strategies: [],
		attempts: [],
		decisions: [],
		consultations: [],
		revision: 0,
		startedAt: 0,
		updatedAt: 0,
		...over,
	} as Parameters<typeof budgetUse>[0];
}

describe("policy v5 (spec/long-horizon-design.md)", () => {
	test("budget is the spec table; everything else equals v3", () => {
		const v3 = policy(3);
		const v5 = policy(5);
		expect(v5.budget).toEqual({
			...v3.budget,
			attempts: 120,
			strategies: 6,
			hypothesesPerStrategy: 4,
			stepBacks: 24,
			transitions: 900,
			wallMs: 90 * 60_000,
		});
		const { version: _a, budget: _b, ...rest3 } = v3;
		const { version: _c, budget: _d, ...rest5 } = v5;
		expect(rest5).toEqual(rest3);
		expect(v3.budget.wallMs).toBe(30 * 60_000);
	});
});

describe("budget use", () => {
	test("counts executed attempts, step backs, transitions and wall time without waiting", () => {
		const use = budgetUse(
			view({
				attempts: [
					attempt("settled"),
					attempt("interrupted"),
					attempt("rejected"),
				],
				strategies: [strategy(1, "a", 0, null), strategy(2, "b", 0, null)],
				decisions: [
					{
						seq: 1,
						kind: "step_back",
						reason: "",
						basis: {},
						decidedBy: "rules",
					},
					{
						seq: 2,
						kind: "change_hypothesis",
						reason: "",
						basis: {},
						decidedBy: "review",
					},
				],
				consultations: [
					{
						id: "c",
						question: "",
						missing: "",
						options: [],
						answer: "x",
						askedAt: 1_000,
						answeredAt: 601_000,
					},
				],
				revision: 450,
				startedAt: 0,
				updatedAt: 600_000 + 2_700_000,
			}),
		);
		expect(use.attempts).toBeCloseTo(2 / 120);
		expect(use.strategies).toBeCloseTo(2 / 6);
		expect(use.stepBacks).toBeCloseTo(1 / 24);
		expect(use.transitions).toBeCloseTo(0.5);
		expect(use.wall).toBeCloseTo(0.5);
		expect(use.max).toBeCloseTo(0.5);
	});

	test("shares are capped at 1", () => {
		const use = budgetUse(view({ revision: 2_000 }));
		expect(use.transitions).toBe(1);
		expect(use.max).toBe(1);
	});
});

describe("progress across strategies", () => {
	test("done share needs parts and an assessment", () => {
		expect(doneShare(strategy(1, "a", 0, []))).toBeNull();
		expect(doneShare(strategy(1, "a", 4, null))).toBeNull();
		expect(doneShare(strategy(1, "a", 4, [1, 3]))).toBe(0.5);
	});

	test("later half compared with the earlier half, by seq", () => {
		const p = progress({
			strategies: [
				strategy(3, "c", 4, [1, 2, 3]),
				strategy(1, "a", 4, [1]),
				strategy(2, "b", 4, [1, 2]),
				strategy(4, "d", 4, [1, 2, 3, 4]),
			],
		});
		expect(p.earlier).toBeCloseTo((0.25 + 0.5) / 2);
		expect(p.later).toBeCloseTo((0.75 + 1) / 2);
		expect(p.gain).toBeCloseTo(0.5);
	});

	test("an odd strategy goes to the later half; one strategy has no gain", () => {
		const three = progress({
			strategies: [
				strategy(1, "a", 2, [1]),
				strategy(2, "b", 2, []),
				strategy(3, "c", 2, [1, 2]),
			],
		});
		expect(three.earlier).toBe(0.5);
		expect(three.later).toBe(0.5);
		expect(
			progress({ strategies: [strategy(1, "a", 2, [1])] }).gain,
		).toBeNull();
	});
});

describe("returns to the same construction", () => {
	test("similarity is symmetric, 1 for equal text and low for unrelated text", () => {
		const a = "部分積分で J_n = ∫ x^n(1-x)^n/(1+x)^{n+1} dx を評価する";
		const b = "素数の積の評価から二項係数の上界を出す";
		expect(similarity(a, a)).toBe(1);
		expect(similarity(a, b)).toBe(similarity(b, a));
		expect(similarity(a, b)).toBeLessThan(0.2);
		expect(similarity("a b", "ab")).toBe(1);
	});

	test("counts later strategies close to any earlier one", () => {
		const base = "Beukers の積分 ∫∫ P_n(x)P_n(y)/(1-xy) で整数性と評価を示す";
		const r = returns({
			strategies: [
				strategy(1, base, 0, null),
				strategy(2, "Apéry の漸化式から有理近似を作る", 0, null),
				strategy(3, `${base}（評価を丁寧に）`, 0, null),
			],
		});
		expect(r.maxSimilarity).toHaveLength(2);
		expect(r.maxSimilarity[0]!).toBeLessThan(0.5);
		expect(r.maxSimilarity[1]!).toBeGreaterThanOrEqual(0.5);
		expect(r.count).toBe(1);
	});
});

describe("endings", () => {
	const rec = (over: Partial<RunRecord>) =>
		({
			error: null,
			outcome: "stopped",
			verified: false,
			reason: "",
			...over,
		}) as RunRecord;
	test("budget stops are told apart", () => {
		expect(budgetStop("追求全体の試行予算を使い切りました")).toBe("attempts");
		expect(budgetStop("追求全体の時間予算を使い切りました")).toBe("wall_time");
		expect(budgetStop("追求全体の手順数の上限に達しました")).toBe(
			"transitions",
		);
		expect(budgetStop("評価の手順数の上限")).toBe("eval_max_steps");
		expect(budgetStop("証明が書けない")).toBeNull();
	});
	test("ending classes match analyze.ts", () => {
		expect(
			ending(rec({ outcome: "completed", verified: true }), undefined),
		).toBe("verified");
		expect(
			ending(rec({ outcome: "incomplete", reason: "無理" }), undefined),
		).toBe("gave_up");
		expect(
			ending(rec({ reason: "追求全体の試行予算を使い切りました" }), undefined),
		).toBe("budget_attempts");
		expect(
			ending(rec({ reason: "x" }), {
				decisions: [
					{ seq: 1, kind: "stop", reason: "", basis: {}, decidedBy: "review" },
				],
			}),
		).toBe("stopped_by_review");
		const row = horizonRow(
			rec({ reason: "追求全体の時間予算を使い切りました" }),
			view(),
		);
		expect(row.ending).toBe("forced_stop");
		expect(row.budgetStop).toBe("wall_time");
	});
});

test("E1R is E3 without the judge", () => {
	const opts = {
		adapter: null,
		language: "ja",
		findings: "verified",
		strategyChange: "free",
		selfCheck: "parts",
		verifyOn: "claim",
		prediction: "falsifiable",
		completionCheck: "acceptance",
	} as const;
	const e1r = conditionsFor("E1R", opts);
	const e3 = conditionsFor("E3", opts);
	expect(e1r).toEqual({ ...e3, judge: false });
});
