import { describe, expect, test } from "bun:test";
import { conditionsSchema } from "../../src/index.ts";
import { startInput } from "../support.ts";
import {
	call,
	hypothesis,
	plan,
	proposal,
	run,
	runtime,
	workspace,
} from "./harness.ts";

// One write uses up the hypothesis budget (1), the step back abandons the hypothesis, the
// next hypothesis gets one propose, which gives up.
const script = () => ({
	plan: [plan],
	hypothesize: [hypothesis, hypothesis],
	propose: [call("write"), proposal("give_up")],
});
const NOTICE = "## 作業領域の巻き戻し";
async function scenario(
	rollback: "notify" | "keep",
	restore: "always" | "protective" = "always",
) {
	const { ws, log } = workspace();
	const out = await run({
		script: script(),
		conditions: { rollback },
		policy: (p) => ({
			...p,
			restore,
			budget: { ...p.budget, attemptsPerHypothesis: 1 },
			signals: { ...p.signals, consecutiveFailures: 50 },
		}),
		runtime: runtime({ ws }),
	});
	return { ...out, log };
}

describe("forced step-back rollback (spec/fixes-2026-10-22.md §a)", () => {
	test("older conditions parse with rollback notify", () => {
		const { rollback, ...old } = startInput().conditions;
		expect(conditionsSchema.parse(old).rollback).toBe("notify");
		expect(rollback).toBe("notify");
	});

	test("keep never reverts and says nothing", async () => {
		const { view, prompts, log } = await scenario("keep");
		expect(log.restores).toBe(0);
		expect(view.decisions.some((d) => "reverted" in d.basis)).toBe(false);
		expect(prompts.some((p) => p.prompt.includes(NOTICE))).toBe(false);
	});

	test("notify reverts, records the files and names them until the next attempt", async () => {
		const { view, prompts, log } = await scenario("notify");
		expect(log.restores).toBe(1);
		const dec = view.decisions.find((d) => Array.isArray(d.basis.reverted));
		expect(dec?.kind).toBe("change_hypothesis");
		expect(dec?.basis.reverted).toEqual(["docs/b.md", "src/a.py"]);
		expect(dec?.basis.attemptsAtRevert).toBe(1);
		const after = prompts.filter((p) => p.prompt.includes(NOTICE));
		expect(after.map((p) => p.purpose)).toEqual(["hypothesize", "propose"]);
		expect(after[0]!.prompt).toContain("docs/b.md, src/a.py");
	});

	test("a protective restore without damage signals does not revert", async () => {
		const { prompts, log } = await scenario("notify", "protective");
		expect(log.restores).toBe(0);
		expect(prompts.some((p) => p.prompt.includes(NOTICE))).toBe(false);
	});
});
