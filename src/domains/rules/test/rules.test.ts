import { describe, expect, test } from "bun:test";
import type { ToolDescriptor } from "../../../contracts/index.ts";
import type { AttemptRow, PursuitView } from "../../ledger/types.ts";
import { ruleRejections, signals } from "../checks.ts";
import { fingerprint } from "../fingerprint.ts";
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
	test("ignores key order and whitespace", () => {
		expect(fingerprint(read, { a: 1, b: "x  y" }, null)).toBe(
			fingerprint(read, { b: " x y", a: 1 }, null),
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
