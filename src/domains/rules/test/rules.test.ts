import { acceptancePassed } from "../acceptance.ts";
import { acceptancePassed as publicAcceptancePassed } from "../../../index.ts";
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
	describe("scope growth counts task files only (spec/fixes-2026-10-22.md §d)", () => {
		const run = (steps: { tool: string; files: string[] }[]): AttemptRow[] =>
			steps.map((step, i) =>
				attempt(i + 1, {
					outcome: "success",
					tool: step.tool,
					features: {
						filesTouched: step.files,
						linesChanged: step.files.length,
						protectedTouched: [],
						match: null,
						progress: null,
					},
				}),
			);
		const fired = (attempts: AttemptRow[]) =>
			signals(view(attempts), "h1", policy, new Set(["write", "run"])).some(
				(s) => s.code === "scope_growth",
			);
		const reads = Array.from({ length: 11 }, () => ({
			tool: "read",
			files: [] as string[],
		}));
		test("eleven read-only attempts and a few scratch files do not fire (hz11u)", () => {
			// filesTouched is cumulative since the hypothesis checkpoint.
			const scratch = [
				["scratch/explore.py", "scratch/explore.txt"],
				[
					"scratch/explore.py",
					"scratch/explore.txt",
					"scratch/explore2.py",
					"scratch/explore2.txt",
				],
				[
					"scratch/explore.py",
					"scratch/explore.txt",
					"scratch/explore2.py",
					"scratch/explore2.txt",
					"notes/solve.md",
					"src/__pycache__/x.pyc",
				],
			].map((files) => ({ tool: "run", files }));
			expect(fired(run([...reads, ...scratch]))).toBe(false);
			// The same three runs counted under v1.6 (cumulative size strictly growing).
		});
		test("real sprawl still fires, with reads in between skipped", () => {
			const a = ["src/a.py"];
			const ab = [...a, "src/b.py"];
			const abc = [...ab, "lib/c.py"];
			expect(
				fired(
					run([
						{ tool: "write", files: a },
						{ tool: "read", files: a },
						{ tool: "write", files: ab },
						{ tool: "read", files: ab },
						{ tool: "write", files: abc },
					]),
				),
			).toBe(true);
		});
		test("a changing attempt that adds no new task file breaks the run", () => {
			const a = ["src/a.py"];
			const ab = [...a, "src/b.py"];
			const abc = [...ab, "lib/c.py"];
			expect(
				fired(
					run([
						{ tool: "write", files: a },
						{ tool: "write", files: ab },
						{ tool: "write", files: ab },
						{ tool: "write", files: abc },
					]),
				),
			).toBe(false);
		});
		test("scratch directories come from the policy", () => {
			const files = (n: number) =>
				Array.from({ length: n }, (_, i) => `work/f${i}`);
			const steps = [1, 2, 3].map((n) => ({ tool: "run", files: files(n) }));
			expect(fired(run(steps))).toBe(true);
			expect(
				signals(
					view(run(steps)),
					"h1",
					{ ...policy, signals: { ...policy.signals, scratchDirs: ["work"] } },
					new Set(["run"]),
				).some((s) => s.code === "scope_growth"),
			).toBe(false);
		});
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

describe("acceptancePassed (spec/fixes-2026-10-22.md §g)", () => {
	const frozen = [{ id: "A1" }, { id: "A2" }];
	const r = (id: string, passed = true) => ({ id, passed, evidence: "" });
	test("exactly the frozen criteria, once each, in any order, all passed", () => {
		expect(acceptancePassed(frozen, [r("A2"), r("A1")])).toBe(true);
	});
	test("a failed, missing, extra, duplicated or unknown criterion does not pass", () => {
		expect(acceptancePassed(frozen, [r("A1"), r("A2", false)])).toBe(false);
		expect(acceptancePassed(frozen, [r("A1")])).toBe(false);
		expect(acceptancePassed(frozen, [r("A1"), r("A2"), r("A3")])).toBe(false);
		expect(acceptancePassed(frozen, [r("A1"), r("A1")])).toBe(false);
		expect(acceptancePassed(frozen, [r("A1"), r("B2")])).toBe(false);
	});
	test("empty acceptance never passes", () => {
		expect(acceptancePassed([], [])).toBe(false);
	});
	test("the public entry point exports it", () => {
		expect(publicAcceptancePassed).toBe(acceptancePassed);
	});
});
