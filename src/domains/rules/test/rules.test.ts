import { describe, expect, test } from "bun:test";
import type { ToolDescriptor } from "../../../contracts/index.ts";
import type { AttemptRow, PursuitView } from "../../ledger/types.ts";
import { ruleRejections, signals, remainingWallMs } from "../checks.ts";
import {
	fingerprint,
	legacyFingerprint,
	sameConditions,
	digestJson,
} from "../fingerprint.ts";
import { policy, startInput } from "../../../../test/support.ts";

const read: ToolDescriptor = {
	name: "read",
	description: "",
	inputSchema: {},
	sideEffect: "none",
	permission: "r",
};
const write: ToolDescriptor = {
	...read,
	name: "write",
	sideEffect: "workspace",
	fingerprintFields: ["path", "content"],
};

function attempt(seq: number, patch: Partial<AttemptRow> = {}): AttemptRow {
	return {
		id: `a${seq}`,
		hypothesisId: "h1",
		seq,
		state: "settled",
		tool: "write",
		input: { path: "src/a.ts" },
		prediction: { expectedStatus: "ok", expectedObservation: "通る" },
		whatChanged: "",
		fingerprint: `f${seq}`,
		rejection: null,
		observation: { status: "ok", output: null, errorCode: null },
		outcome: "failure",
		refs: [],
		features: {
			filesTouched: ["src/a.ts"],
			linesChanged: 1,
			protectedTouched: [],
			match: null,
			progress: null,
		},
		startedAt: seq,
		...patch,
	};
}

function view(attempts: AttemptRow[]): PursuitView {
	return {
		id: "p",
		goal: "g",
		status: "proposing",
		revision: 1,
		input: startInput(),
		currentStrategyId: "s1",
		currentHypothesisId: "h1",
		startedAt: 0,
		updatedAt: 0,
		acceptance: [],
		strategies: [],
		judgements: [],
		decisions: [],
		consultations: [],
		verifications: [],
		inference: [],
		report: null,
		findings: [],
		hypotheses: [
			{
				id: "h1",
				strategyId: "s1",
				seq: 1,
				body: "",
				rationale: "",
				tools: [],
				expected: "",
				budget: 6,
				checkpoint: null,
				status: "active",
				result: null,
			},
		],
		attempts,
	};
}

describe("fingerprint", () => {
	test("ignores object key order but preserves all string whitespace", () => {
		expect(fingerprint(read, { a: 1, b: "x  y" }, null)).toBe(
			fingerprint(read, { b: "x  y", a: 1 }, null),
		);
		expect(fingerprint(read, { b: "x  y" }, null)).not.toBe(
			fingerprint(read, { b: " x y" }, null),
		);
	});
	test("read-only tools ignore workspace state; changing tools include it", () => {
		expect(fingerprint(read, { a: 1 }, "d1")).toBe(
			fingerprint(read, { a: 1 }, "d2"),
		);
		expect(fingerprint(write, { path: "p" }, "d1")).not.toBe(
			fingerprint(write, { path: "p" }, "d2"),
		);
	});
	test("only declared fields define the conditions", () => {
		expect(
			fingerprint(write, { path: "p", content: "c", note: "x" }, "d"),
		).toBe(fingerprint(write, { path: "p", content: "c", note: "y" }, "d"));
	});
});

describe("rule rejections", () => {
	const base = {
		hypothesis: view([]).hypotheses[0]!,
		policy,
		prediction: { expectedStatus: "ok" as const, expectedObservation: "x" },
	};
	test("prediction is required", () => {
		const out = ruleRejections({
			...base,
			view: view([]),
			prediction: { expectedStatus: "ok", expectedObservation: " " },
			whatChanged: "",
			fingerprint: "f",
		});
		expect(out.map((r) => r.rule)).toEqual(["prediction_required"]);
	});
	test("a failed fingerprint needs a reason, then is capped", () => {
		const v1 = view([attempt(1, { fingerprint: "same" })]);
		expect(
			ruleRejections({
				...base,
				view: v1,
				whatChanged: "",
				fingerprint: "same",
			}).map((r) => r.rule),
		).toEqual(["same_failure"]);
		expect(
			ruleRejections({
				...base,
				view: v1,
				whatChanged: "入力を変えた",
				fingerprint: "same",
			}),
		).toEqual([]);
		const v2 = view([
			attempt(1, { fingerprint: "same" }),
			attempt(2, { fingerprint: "same" }),
		]);
		expect(
			ruleRejections({
				...base,
				view: v2,
				whatChanged: "理由",
				fingerprint: "same",
			}).map((r) => r.rule),
		).toEqual(["same_failure_limit"]);
	});
	test("hypothesis budget", () => {
		const v = view(
			[1, 2, 3, 4, 5, 6].map((n) => attempt(n, { outcome: "success" })),
		);
		expect(
			ruleRejections({
				...base,
				view: v,
				whatChanged: "",
				fingerprint: "new",
			}).map((r) => r.rule),
		).toEqual(["hypothesis_budget"]);
	});
});

describe("signals", () => {
	const tools = new Set(["write"]);
	for (const feature of ["match", "progress"] as const)
		for (const values of [
			[0.4, 0.3, 0.2, 0.1],
			[0.4, 0.3, null, 0.2, 0.1],
			[0.4, 0.3, 0.2, 0.1, null],
		])
			test(`${feature} trends do not bridge missing observations: ${values.join(",")}`, () => {
				const attempts = values.map((value, index) =>
					attempt(index + 1, {
						outcome: "success",
						features: {
							filesTouched: [],
							linesChanged: 0,
							protectedTouched: [],
							match: null,
							progress: null,
							[feature]: value ?? null,
						},
					}),
				);
				const code =
					feature === "match" ? "mismatch_not_shrinking" : "goal_drift";
				expect(
					signals(view(attempts), "h1", policy, tools).some(
						(s) => s.code === code,
					),
				).toBe(!values.includes(null));
			});
	test("consecutive failures", () => {
		const codes = signals(
			view([attempt(1), attempt(2), attempt(3)]),
			"h1",
			policy,
			tools,
		).map((s) => s.code);
		expect(codes).toContain("consecutive_failures");
	});
	test("touching tests fires at once", () => {
		const a = attempt(1, {
			outcome: "success",
			features: {
				filesTouched: ["test/a.test.ts"],
				linesChanged: 3,
				protectedTouched: ["test/a.test.ts"],
				match: null,
				progress: null,
			},
		});
		expect(signals(view([a]), "h1", policy, tools).map((s) => s.code)).toEqual([
			"protected_touch",
		]);
	});
	test("growing scope", () => {
		const grow = [1, 2, 3, 4].map((n) =>
			attempt(n, {
				outcome: "success",
				features: {
					filesTouched: Array.from({ length: n }, (_, i) => `f${i}`),
					linesChanged: n,
					protectedTouched: [],
					match: null,
					progress: null,
				},
			}),
		);
		expect(signals(view(grow), "h1", policy, tools).map((s) => s.code)).toEqual(
			["scope_growth"],
		);
	});
	test("no signal on a healthy run", () => {
		const ok = [1, 2].map((n) => attempt(n, { outcome: "success" }));
		expect(signals(view(ok), "h1", policy, tools)).toEqual([]);
	});
});

describe("versioned conditions and interrupted retries", () => {
	test("legacy matching requires an attested contract and exact selected input", () => {
		const t = { ...write, legacyFingerprintCompatible: true };
		const old = {
			tool: t.name,
			input: { path: "a", content: "A  B" },
			fingerprint: legacyFingerprint(
				t,
				{ path: "a", content: "A  B" },
				"state",
			),
		};
		expect(
			sameConditions(old, t, { path: "a", content: "A  B" }, "state"),
		).toBe(true);
		expect(sameConditions(old, t, { path: "a", content: "A B" }, "state")).toBe(
			false,
		);
		expect(
			sameConditions(old, t, { path: "a", content: "A  B" }, "other"),
		).toBe(false);
		expect(sameConditions(old, write, old.input, "state")).toBeNull();
	});
	test("v2 preserves newlines, Unicode and source text; contract changes are explicit", () => {
		const variants = ["A B", "A  B", " A B", "A B ", "A\nB", "A\tB", "é", "é"];
		expect(
			new Set(
				variants.map((content) =>
					fingerprint(write, { path: "a", content }, "s"),
				),
			).size,
		).toBe(variants.length);
		const input = { path: "a", content: "code" };
		const old = {
			tool: write.name,
			input,
			fingerprint: fingerprint(write, input, "s"),
		};
		expect(
			sameConditions(
				old,
				{ ...write, fingerprintFields: ["path"] },
				input,
				"s",
			),
		).toBeNull();
		expect(digestJson({ b: 1, a: 2 })).toBe(digestJson({ a: 2, b: 1 }));
		expect(digestJson({ a: "A B" })).not.toBe(digestJson({ a: "A  B" }));
	});
	test("interrupted outcomes need a reason and remain capped and budgeted", () => {
		const a = attempt(1, {
			state: "interrupted",
			outcome: null,
			fingerprint: "same",
		});
		const v = view([a]);
		const base = {
			view: v,
			hypothesis: v.hypotheses[0]!,
			prediction: a.prediction,
			whatChanged: "",
			fingerprint: "same",
			policy,
		};
		expect(ruleRejections(base).map((r) => r.rule)).toEqual(["same_failure"]);
		expect(ruleRejections({ ...base, whatChanged: "changed" })).toEqual([]);
		expect(
			ruleRejections({
				...base,
				view: view([a, { ...a, id: "a2", seq: 2 }]),
				whatChanged: "reason",
			}).map((r) => r.rule),
		).toContain("same_failure_limit");
		expect(
			ruleRejections({ ...base, sameConditions: () => null }).map(
				(r) => r.rule,
			),
		).toContain("retry_history_unavailable");
		expect(
			ruleRejections({
				...base,
				view: view([a]),
				hypothesis: { ...base.hypothesis, budget: 1 },
				fingerprint: "different",
			}).map((r) => r.rule),
		).toContain("hypothesis_budget");
	});
});

test("consultation waits pause wall time and resume with remaining active budget", () => {
	const v = { ...view([]), startedAt: 1000 };
	const budget = v.input.policy.budget.wallMs;
	const waiting = {
		...v,
		consultations: [
			{
				id: "c",
				question: "q",
				missing: "m",
				options: [],
				answer: null,
				askedAt: 1100,
				answeredAt: null,
			},
		],
	};
	expect(remainingWallMs(waiting, 1000 + budget * 2)).toBe(budget - 100);
	const answered = {
		...waiting,
		consultations: [
			{
				...waiting.consultations[0]!,
				answer: "a",
				answeredAt: 1000 + budget * 2,
			},
		],
	};
	expect(remainingWallMs(answered, 1000 + budget * 2 + 100)).toBe(budget - 200);
});
