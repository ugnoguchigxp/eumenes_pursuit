import { describe, expect, test } from "bun:test";
import {
	LlmOutputError,
	type LlmPort,
	type ToolDescriptor,
	type ToolPort,
} from "../../src/index.ts";
import { directStopReasons, endNoticeText, runDirect } from "../direct.ts";
import {
	compare,
	isCorrect,
	measureDirect,
	withDiagnostics,
	withOutcomeFacts,
	type RunRecord,
} from "../metrics.ts";

const step = (kind: string, extra: Record<string, unknown> = {}) => ({
	kind,
	tool: null,
	inputJson: null,
	text: null,
	message: "m",
	...extra,
});
const use = (tool: string, input: object = {}) =>
	step("tool", { tool, inputJson: JSON.stringify(input) });

/** Scripted responder; `null` in the script = an invalid response (LlmOutputError). */
function scripted(script: (object | null)[]) {
	const prompts: string[] = [];
	const llm: LlmPort = {
		async complete(request) {
			prompts.push(request.prompt);
			expect(request.purpose).toBe("direct");
			const next = script.shift();
			if (next === undefined) throw new Error("script_exhausted");
			if (next === null) throw new LlmOutputError("schema", "scripted");
			return {
				value: request.schema.parse(next),
				model: "scripted",
				inputTokens: 10,
				outputTokens: 2,
				cacheReadTokens: 0,
				latencyMs: 1,
			};
		},
	};
	return { llm, prompts };
}
const read: ToolDescriptor = {
	name: "read",
	description: "資料を読む",
	inputSchema: {},
	sideEffect: "none",
	permission: "data.read",
};
const secret: ToolDescriptor = {
	name: "secret",
	description: "",
	inputSchema: {},
	sideEffect: "none",
	permission: "not.granted",
};
function setup(passAfterCalls: number) {
	let calls = 0;
	let verifies = 0;
	const tools: ToolPort = {
		list: () => [read, secret],
		invoke: async () => {
			calls++;
			return { status: "ok", output: { text: "x".repeat(5000) }, refs: [] };
		},
	};
	return {
		tools,
		acceptancePort: {
			verify: async () => {
				verifies++;
				const passed = calls >= passAfterCalls;
				return [{ id: "a", passed, evidence: passed ? "合格" : "不合格" }];
			},
		},
		counts: () => ({ calls, verifies }),
	};
}
const budget = { toolCalls: 10, wallMs: 60_000, requests: 50 };
const base = {
	goal: "目標の文",
	acceptance: [{ id: "a", text: "条件の文" }],
	grant: ["data.read"],
	workspace: null,
	signal: AbortSignal.timeout(5000),
};

describe("direct baseline (D0)", () => {
	test("a failed claim returns 不合格 and the run continues; a passing claim completes", async () => {
		const env = setup(2);
		const { llm, prompts } = scripted([
			use("read"),
			step("done"),
			use("read"),
			step("done"),
		]);
		const r = await runDirect({ ...base, ...env, llm, budget });
		expect(r.outcome).toBe("completed");
		expect(r.verified).toBe(true);
		expect([r.toolCalls, r.claims, r.failedClaims, r.requests]).toEqual([
			2, 2, 1, 4,
		]);
		expect(prompts[2]).toContain("完了の申告 → 不合格: [a] ng 不合格");
		expect(prompts[2]).toContain("直近の完了の申告は不合格でした");
		expect(env.counts().verifies).toBe(2);
	});

	test("the prompt has goal, criteria, tools and history, and no pursuit structure", async () => {
		const env = setup(99);
		const { llm, prompts } = scripted([use("read"), step("give_up")]);
		const r = await runDirect({ ...base, ...env, llm, budget });
		expect(r.outcome).toBe("incomplete");
		for (const word of ["目標の文", "[a] 条件の文", '"name":"read"', "#1 read"])
			expect(prompts[1]).toContain(word);
		for (const word of ["仮説", "方針", "予測", "知見", "振り返"])
			expect(prompts.join("\n")).not.toContain(word);
		// Same per-entry clipping as the pursuit's current-hypothesis view (1800 characters).
		expect(prompts[1]).toContain(
			"…［この一覧での表示はここまで。実物は省略されていない］",
		);
		// The final check runs at the end, as in the pursuit's finish().
		expect(env.counts().verifies).toBe(1);
	});

	test("the tool-call budget stops the run with the pursuit's reason; final check still runs", async () => {
		const env = setup(99);
		const { llm } = scripted([use("read"), use("read"), use("read")]);
		const r = await runDirect({
			...base,
			...env,
			llm,
			budget: { ...budget, toolCalls: 2 },
		});
		expect(r.outcome).toBe("stopped");
		expect(r.reason).toBe(directStopReasons.toolCalls);
		expect(r.toolCalls).toBe(2);
		expect(env.counts().verifies).toBe(1);
	});

	test("the wall-clock and request budgets stop the run", async () => {
		const env = setup(99);
		let t = 0;
		const timed = await runDirect({
			...base,
			...env,
			llm: scripted([use("read"), use("read")]).llm,
			budget: { ...budget, wallMs: 100 },
			now: () => (t += 60),
		});
		expect(timed.reason).toBe(directStopReasons.wall);
		const capped = await runDirect({
			...base,
			...setup(99),
			llm: scripted([step("done"), step("done")]).llm,
			budget: { ...budget, requests: 2 },
		});
		expect(capped.reason).toBe(directStopReasons.requests);
		expect(capped.failedClaims).toBe(2);
	});

	test("unknown or forbidden tools are invalid steps, not tool calls; 3 bad outputs in a row stop", async () => {
		const env = setup(99);
		const { llm } = scripted([
			use("nope"),
			use("secret"),
			step("tool", { tool: "read", inputJson: "[1]" }),
			null,
			null,
			null,
		]);
		const r = await runDirect({ ...base, ...env, llm, budget });
		expect(r.toolCalls).toBe(0);
		expect(env.counts().calls).toBe(0);
		expect(r.invalidSteps).toBe(6);
		expect(r.reason).toBe(directStopReasons.invalid);
	});

	test("records use the pursuit's fields: correctness, false completion, over-stopping", async () => {
		const env = setup(1);
		const r = await runDirect({
			...base,
			...env,
			llm: scripted([use("read"), step("done")]).llm,
			budget,
		});
		const measured = measureDirect(r, "direct_x", () => undefined);
		expect(measured.mode).toBe("direct");
		expect(measured.stepBacks).toBe(0);
		// An answer on an unsolvable task is a false completion even when the check passed.
		const unsolvable = withOutcomeFacts(measured, {
			solvable: false,
			submitted: "answer",
		});
		expect(unsolvable.falseCompletion).toBe(true);
		const declared = withOutcomeFacts(
			{ ...measured, outcome: "incomplete", verified: false },
			{ solvable: true, submitted: "declaration" },
		);
		expect(declared.overStopped).toBe(true);
		expect(isCorrect("completed", { ...measured, error: null })).toBe(true);
		const d = withDiagnostics(measured, {
			canaryHits: 1,
			canaryKinds: ["collect"],
			graderVerdict: "pass",
		});
		expect(d.canaryHits).toBe(1);
	});

	test("compare puts pursuit and direct side by side per family and per task", () => {
		const rec = (over: Partial<RunRecord>): RunRecord =>
			({
				run: "r",
				task: "hz10a-x",
				group: "E",
				condition: "E1R",
				generator: "g",
				level: null,
				repeat: 1,
				pursuitId: "p",
				expected: "completed",
				outcome: "completed",
				verified: true,
				reason: "",
				correct: true,
				falseCompletion: false,
				failedClaims: 0,
				attempts: 8,
				rejected: 0,
				rejectionsByRule: {},
				protectedTouches: 0,
				sameFailureRepeats: 0,
				predictionMissing: 0,
				hypotheses: 1,
				strategies: 1,
				stepBacks: 0,
				stepBacksBy: {},
				consultations: 0,
				judgeCalls: 0,
				judgeFailures: 0,
				judgeFired: 0,
				llmCalls: 12,
				inputTokens: 0,
				outputTokens: 0,
				usd: 0,
				durationMs: 120_000,
				error: null,
				...over,
			}) as RunRecord;
		const text = compare([
			rec({ budgetTag: "v5" }),
			rec({
				condition: "D0",
				mode: "direct",
				budgetTag: "v5",
				toolCalls: 5,
				responderRequests: 6,
				canaryHits: 2,
				graderVerdict: "fail",
				correct: false,
				verified: false,
				outcome: "incomplete",
			}),
		]);
		expect(text).toContain("| hz10a | direct | v5 | 1 | 0% |");
		expect(text).toContain("| hz10a | pursuit | v5 | 1 | 100% |");
		expect(text).toContain("| 2/1 | 0/1 |");
		expect(text).toContain("| hz10a-x | × 道具5.0 | ○ 道具8.0 |");
	});

	test("end notice: the last claim's verdict in the pursuit's words, or no claim; never the final check", () => {
		const passed = endNoticeText("目標の文 ".repeat(20), {
			passed: true,
			criteria: [{ id: "a", passed: true, evidence: "合格" }],
		});
		expect(passed).toContain("前の課題（目標の冒頭: 目標の文 目標の文");
		expect(passed).toContain("最後の完了の申告の照合: 合格: [a] ok 合格");
		expect(endNoticeText("g", null)).toContain(
			"完了の申告はありませんでした。",
		);
	});

	test("claim criteria are kept per claim for the end notice", async () => {
		const env = setup(1);
		const r = await runDirect({
			...base,
			...env,
			llm: scripted([step("done"), use("read"), step("done")]).llm,
			budget,
		});
		expect(r.claimCriteria.map((c) => c[0]!.passed)).toEqual([false, true]);
	});
});
