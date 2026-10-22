import { describe, expect, test } from "bun:test";
import {
	conditionsSchema,
	createPursuitEngine,
	type LlmPort,
	type LlmPurpose,
	type PursuitRuntime,
	type ToolDescriptor,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { policy, startInput } from "../support.ts";
import { reviewRequest } from "../../src/domains/generation/prompts.ts";
import {
	failedClaims,
	oracleAcceptance,
	parseClaimOracle,
} from "../../eval/claim-oracle.ts";

/** Scripted answers per purpose; records every prompt by purpose. */
function scripted(script: Partial<Record<LlmPurpose, unknown[]>>) {
	const prompts: { purpose: LlmPurpose; prompt: string }[] = [];
	const llm: LlmPort = {
		async complete(request) {
			prompts.push({ purpose: request.purpose, prompt: request.prompt });
			const next = script[request.purpose]?.shift();
			if (next === undefined)
				throw new Error(`script_exhausted:${request.purpose}`);
			return {
				value: request.schema.parse(next),
				model: "scripted",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				latencyMs: 1,
			};
		},
	};
	return { llm, prompts };
}
const plan = { strategy: "方針", rationale: "r", alternatives: ["別案"] };
const hypothesis = {
	hypothesis: "仮説",
	rationale: "r",
	tools: ["read"],
	expected: "e",
};
const proposal = (kind: string, extra: Record<string, unknown> = {}) => ({
	kind,
	tool: null,
	inputJson: null,
	expectedStatus: null,
	expectedObservation: null,
	whatChanged: "",
	message: "m",
	missing: "",
	text: null,
	...extra,
});
let k = 0;
const call = (name: string) =>
	proposal("tool", {
		tool: name,
		inputJson: JSON.stringify({ n: ++k }),
		expectedStatus: "ok",
		expectedObservation: "値が返る",
	});
const read: ToolDescriptor = {
	name: "read",
	description: "",
	inputSchema: {},
	sideEffect: "none",
	permission: "data.read",
};
const write: ToolDescriptor = {
	name: "write",
	description: "",
	inputSchema: {},
	sideEffect: "workspace",
	permission: "answer.write",
};
function runtime(
	passes = false,
	evidence = passes ? "合格" : "不合格",
	oracle = parseClaimOracle({}),
): PursuitRuntime {
	return {
		tools: {
			list: () => [read, write],
			invoke: async () => ({ status: "ok", output: { v: 1 }, refs: [] }),
		},
		workspace: null,
		acceptance: oracleAcceptance(
			{ verify: async () => [{ id: "total", passed: passes, evidence }] },
			oracle,
		),
	};
}
async function run(
	script: Partial<Record<LlmPurpose, unknown[]>>,
	extra: Record<string, unknown>,
	perHypothesis = 2,
	rt: PursuitRuntime = runtime(),
) {
	const { llm, prompts } = scripted(script);
	const store = openStore(":memory:", migrations);
	let n = 0;
	const engine = createPursuitEngine({
		store,
		clock: { now: () => 1000 + n },
		ids: { next: (p) => `${p}${n++}` },
		generator: llm,
		reviewer: null,
		judge: null,
	});
	const base = startInput();
	const { pursuitId } = await engine.start(
		startInput({
			policy: {
				...policy,
				budget: { ...policy.budget, attemptsPerHypothesis: perHypothesis },
				signals: { ...policy.signals, consecutiveFailures: 50 },
			},
			conditions: { ...base.conditions, ...extra },
		}),
		`k${++k}`,
	);
	for (let i = 0; i < 40; i++) {
		const r = await engine.step(pursuitId, rt, AbortSignal.timeout(5000));
		if (r.done) break;
	}
	return { view: (await engine.view(pursuitId))!, prompts };
}
const budgetStepBacks = (view: Awaited<ReturnType<typeof run>>["view"]) =>
	view.decisions.filter(
		(d) => d.kind === "step_back" && d.basis.rule === "hypothesis_budget",
	).length;

describe("ablation flags (default off keeps earlier runs reproducible)", () => {
	test("older conditions parse with claimFeedback off and attemptCount all", () => {
		const { claimFeedback, attemptCount, ...old } = startInput().conditions;
		const parsed = conditionsSchema.parse(old);
		expect(parsed.claimFeedback).toBe("off");
		expect(parsed.attemptCount).toBe("all");
		expect([claimFeedback, attemptCount]).toEqual(["off", "all"]);
	});

	test("attemptCount all: read-only calls exhaust the hypothesis budget", async () => {
		const { view } = await run(
			{
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [call("read"), call("read"), proposal("give_up")],
			},
			{ attemptCount: "all" },
		);
		expect(budgetStepBacks(view)).toBe(1);
	});

	test("attemptCount mutating: reads alone do not exhaust it; writes do", async () => {
		const reads = await run(
			{
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("read"),
					call("read"),
					call("read"),
					call("read"),
					proposal("give_up"),
				],
			},
			{ attemptCount: "mutating" },
		);
		expect(budgetStepBacks(reads.view)).toBe(0);
		expect(
			reads.view.attempts.filter((a) => a.state === "settled"),
		).toHaveLength(4);
		expect(
			reads.prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt,
		).toContain("試行予算: 0/2（数えるのは作業領域を変える道具だけ）");
		const writes = await run(
			{
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read"),
					call("write"),
					call("write"),
					proposal("give_up"),
				],
			},
			{ attemptCount: "mutating" },
		);
		expect(budgetStepBacks(writes.view)).toBe(1);
	});

	test("claimFeedback verdict: the failed claim is stated in later proposal and hypothesis prompts", async () => {
		const { prompts } = await run(
			{
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					proposal("done"),
					proposal("done"),
					proposal("done"),
					proposal("give_up"),
				],
			},
			{ claimFeedback: "verdict", verifyOn: "claim" },
			6,
		);
		const proposals = prompts.filter((p) => p.purpose === "propose");
		expect(proposals[1]!.prompt).toContain(
			"## 完了の申告の結果（ホストの照合）",
		);
		expect(proposals[1]!.prompt).toContain("申告1: 不合格: [total] ng 不合格");
		expect(proposals[1]!.prompt).toContain("直近の完了の申告は不合格でした");
		// After the step back (3 rejections in a row), the next hypothesis still sees it.
		const second = prompts.filter((p) => p.purpose === "hypothesize")[1]!;
		expect(second.prompt).toContain("申告3: 不合格");
	});

	test("claimFeedback off: the earlier wording, and nothing in the hypothesis prompt", async () => {
		const { prompts } = await run(
			{
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					proposal("done"),
					proposal("done"),
					proposal("done"),
					proposal("give_up"),
				],
			},
			{ verifyOn: "claim" },
			6,
		);
		const proposals = prompts.filter((p) => p.purpose === "propose");
		expect(proposals[1]!.prompt).toContain("## 完了の申告に対する照合");
		expect(proposals[1]!.prompt).not.toContain("完了の申告の結果");
		const second = prompts.filter((p) => p.purpose === "hypothesize")[1]!;
		expect(second.prompt).not.toContain("完了の申告の結果");
	});

	test("the reviewer sees every claim's verdict; binary evidence hides k/n from generator and reviewer (§6)", async () => {
		const script = () => ({
			plan: [plan],
			hypothesize: [hypothesis, hypothesis],
			propose: [proposal("done"), proposal("done"), proposal("give_up")],
		});
		const go = (evidence: "full" | "binary") =>
			run(
				script(),
				{ claimFeedback: "verdict", verifyOn: "claim" },
				6,
				runtime(
					false,
					"隠された検査 7/9 通過",
					parseClaimOracle({ "claim-evidence": evidence }),
				),
			);
		const full = await go("full");
		const binary = await go("binary");
		expect(failedClaims(full.view)).toBe(2);
		const review = (view: typeof full.view) =>
			reviewRequest({ view, reason: "r", signals: [] }).prompt;
		expect(review(full.view)).toContain("## 完了の申告の結果（ホストの照合）");
		expect(review(full.view)).toContain(
			"申告2: 不合格: [total] ng 隠された検査 7/9 通過",
		);
		expect(review(binary.view)).toContain("申告2: 不合格: [total] ng 不合格");
		const all = [
			...binary.prompts.map((p) => p.prompt),
			review(binary.view),
		].join("\n");
		expect(all).not.toContain("7/9");
	});
});
