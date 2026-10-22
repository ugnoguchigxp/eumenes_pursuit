import { describe, expect, test } from "bun:test";
import type { LlmPort, ToolPort } from "../../src/index.ts";
import {
	claimLimitReached,
	oracleAcceptance,
	oracleGoal,
	oracleTag,
	parseClaimOracle,
} from "../claim-oracle.ts";
import { directStopReasons, runDirect } from "../direct.ts";
import { isCorrect, isForcedStop } from "../metrics.ts";
import { headTail } from "../tasks/e/env.ts";

const hidden = {
	verify: async () => [
		{ id: "build", passed: true, evidence: "出力あり" },
		{ id: "hidden", passed: false, evidence: "隠された検査 7/9 通過" },
	],
};

describe("claim oracle (spec/fixes-2026-10-22-b.md §6), the same for D0 and E*", () => {
	test("defaults are the old behaviour: no tag, goal and evidence unchanged", async () => {
		const o = parseClaimOracle({});
		expect(o).toEqual({ evidence: "full", limit: null });
		expect(oracleTag(o)).toBe("");
		expect(oracleGoal("目標", o)).toBe("目標");
		expect(oracleAcceptance(hidden, o)).toBe(hidden);
	});
	test("binary evidence removes k/n but keeps pass/fail; limit and tags", async () => {
		const o = parseClaimOracle({
			"claim-limit": "2",
			"claim-evidence": "binary",
		});
		expect(oracleTag(o)).toBe("/CL-2/CE-binary");
		const r = await oracleAcceptance(hidden, o).verify(
			AbortSignal.timeout(1000),
		);
		expect(r).toEqual([
			{ id: "build", passed: true, evidence: "合格" },
			{ id: "hidden", passed: false, evidence: "不合格" },
		]);
		expect(JSON.stringify(r)).not.toContain("7/9");
		const goal = oracleGoal("目標", o);
		expect(goal).toContain("完了の申告は 2 回まで");
		expect(goal).toContain("合格・不合格だけ");
		expect([claimLimitReached(1, o), claimLimitReached(2, o)]).toEqual([
			false,
			true,
		]);
		expect(() => parseClaimOracle({ "claim-limit": "0" })).toThrow();
		expect(() => parseClaimOracle({ "claim-evidence": "k" })).toThrow();
	});
	test("the limit is a forced stop: never counted as a correct declaration", () => {
		expect(isForcedStop(directStopReasons.claimLimit)).toBe(true);
		expect(
			isCorrect("incomplete", {
				outcome: "stopped",
				verified: false,
				reason: directStopReasons.claimLimit,
				error: null,
			}),
		).toBe(false);
	});
	test("D0 stops after the limit and its verdicts carry no k/n", async () => {
		const o = parseClaimOracle({
			"claim-limit": "2",
			"claim-evidence": "binary",
		});
		const prompts: string[] = [];
		const steps = ["done", "done", "done"].map((kind) => ({
			kind,
			tool: null,
			inputJson: null,
			text: null,
			message: "m",
		}));
		const llm: LlmPort = {
			async complete(request) {
				prompts.push(request.prompt);
				return {
					value: request.schema.parse(steps.shift()),
					model: "s",
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					latencyMs: 1,
				};
			},
		};
		const tools: ToolPort = {
			list: () => [],
			invoke: async () => ({ status: "ok", output: null, refs: [] }),
		};
		const r = await runDirect({
			goal: oracleGoal("目標", o),
			acceptance: [
				{ id: "build", text: "b" },
				{ id: "hidden", text: "h" },
			],
			grant: [],
			tools,
			workspace: null,
			acceptancePort: oracleAcceptance(hidden, o),
			llm,
			budget: { toolCalls: 10, wallMs: 60_000, requests: 10 },
			signal: AbortSignal.timeout(5000),
			claimLimit: o.limit,
		});
		expect([r.outcome, r.reason, r.claims, r.failedClaims]).toEqual([
			"stopped",
			"完了の申告の上限に達しました",
			2,
			2,
		]);
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain("不合格");
		expect(prompts.join("\n")).not.toContain("7/9");
		expect(prompts[0]).toContain("完了の申告は 2 回まで");
	});
});

describe("run output cap says how to read the rest (§4)", () => {
	test("headTail names the full length and the paging route", () => {
		const out = headTail("a".repeat(10_000), 6000);
		expect(out).toContain("全 10000 字のうち中ほどの 4000 字を省略");
		expect(out).toContain("read_file の offset / limit");
		expect(headTail("short", 6000)).toBe("short");
	});
});
