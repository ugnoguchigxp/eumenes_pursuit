import { describe, expect, test } from "bun:test";
import type { ToolDescriptor } from "../../src/index.ts";
import { policySchema } from "../../src/index.ts";
import { policy } from "../support.ts";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const paged: ToolDescriptor = {
	name: "read",
	description: "",
	inputSchema: {
		type: "object",
		properties: { offset: { type: "integer" }, limit: { type: "integer" } },
	},
	sideEffect: "none",
	permission: "data.read",
};
const plain: ToolDescriptor = { ...paged, name: "dump", inputSchema: {} };

describe("observation clipping (spec/fixes-2026-10-22.md §f)", () => {
	test("policy default: latest 8000 characters, older 1800", () => {
		const { observation, ...older } = policy;
		expect(policySchema.parse(older).observation).toEqual({
			latestChars: 8000,
			olderChars: 1800,
		});
		expect(observation).toEqual({ latestChars: 8000, olderChars: 1800 });
	});

	test("the latest observation is shown much larger; clipped ones say how long and how to read on", async () => {
		const long = (c: string) => c.repeat(20000);
		let n = 0;
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [call("dump"), call("read"), proposal("give_up")],
			},
			policy: (p) => ({ ...p, budget: { ...p.budget, strategies: 1 } }),
			runtime: runtime({
				tools: [paged, plain],
				invoke: () => ({
					status: "ok",
					output: { text: long(n++ ? "B" : "A") },
					refs: [],
				}),
			}),
		});
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		const runOf = (c: string) =>
			Math.max(
				...(last.match(new RegExp(`${c}+`, "g")) ?? [""]).map((m) => m.length),
			);
		// #1 (dump, older): 1800 characters of JSON text; #2 (read, latest): 8000.
		expect(runOf("A")).toBe(1800 - '{"text":"'.length);
		expect(runOf("B")).toBe(8000 - '{"text":"'.length);
		expect(last).toContain(
			"観測は全 20011 字のうち先頭 1800 字だけ表示。範囲や件数を絞って呼び直すか",
		);
		expect(last).toContain(
			"観測は全 20011 字のうち先頭 8000 字だけ表示。この道具は offset / limit で続きを読めます",
		);
	});

	test("short observations are shown whole, without a notice", async () => {
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [call("read"), proposal("give_up")],
			},
			policy: (p) => ({ ...p, budget: { ...p.budget, strategies: 1 } }),
			runtime: runtime({ tools: [paged] }),
		});
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain('観測: ok {"v":1}');
		expect(last).not.toContain("観測は全");
	});
});
