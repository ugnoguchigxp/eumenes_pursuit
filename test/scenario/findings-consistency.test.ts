import { describe, expect, test } from "bun:test";
import { unrecordedFindingRefs } from "../../src/domains/rules/checks.ts";
import type { PursuitView } from "../../src/domains/ledger/types.ts";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const empty = { findings: [], refute: [], uses: [] };
const oneStrategy = (
	p: Parameters<NonNullable<Parameters<typeof run>[0]["policy"]>>[0],
) => ({
	...p,
	budget: { ...p.budget, strategies: 1 },
});

describe("findings consistency (spec/fixes-2026-10-22.md §e)", () => {
	test("cited finding numbers are checked against the ledger", () => {
		const view = {
			findings: [{ seq: 1 }, { seq: 3 }],
		} as unknown as PursuitView;
		expect(
			unrecordedFindingRefs(view, {
				message: "F1 と F2 から判断した（F10a は番号ではない、XF4 も違う）",
				uses: ["F3", "4"],
				refute: [{ id: "F1" }],
				assessment: [{ evidence: "F5 に記録", next: "" }],
				acceptanceCheck: [{ where: "F3 の表" }],
			}),
		).toEqual(["F2", "F4", "F5"]);
		expect(
			unrecordedFindingRefs(view, { message: "知見は使っていない" }),
		).toEqual([]);
	});

	test("a step back citing a finding the ledger lacks is a rule issue; recorded findings may be cited", async () => {
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					proposal("step_back", {
						...empty,
						message: "F1 の結果から別の仮説へ",
					}),
					proposal("give_up", {
						...empty,
						findings: [
							{
								kind: "observation",
								statement: "表の列は 5 つ",
								scope: "pursuit",
							},
						],
						uses: ["F1"],
						message: "F1 を根拠に断念",
					}),
				],
			},
			conditions: { findings: "verified" },
			policy: oneStrategy,
		});
		const rejected = view.attempts.filter((a) => a.state === "rejected");
		expect(rejected.map((a) => a.rejection?.[0]?.rule)).toEqual([
			"finding_not_recorded",
		]);
		expect(rejected[0]!.rejection?.[0]?.detail).toContain("F1");
		expect(view.findings.map((f) => f.statement)).toEqual(["表の列は 5 つ"]);
		expect(view.status).toBe("incomplete");
	});

	test("findings off: no check, no reminder", async () => {
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [proposal("give_up", { message: "F9 を根拠に断念" })],
			},
			policy: oneStrategy,
		});
		expect(view.attempts.filter((a) => a.state === "rejected")).toEqual([]);
		expect(prompts.some((p) => p.prompt.includes("知見: 0 件"))).toBe(false);
	});

	test("after five executed attempts with no finding, plan/hypothesis requests remind once per request", async () => {
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis, hypothesis],
				propose: [
					...Array.from({ length: 5 }, () => ({ ...call("read"), ...empty })),
					proposal("step_back", empty),
					proposal("give_up", empty),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "verified" },
			policy: (p) => ({
				...oneStrategy(p),
				budget: { ...oneStrategy(p).budget, attemptsPerHypothesis: 5 },
			}),
			runtime: runtime(),
		});
		const hyps = prompts.filter((p) => p.purpose === "hypothesize");
		expect(hyps[0]!.prompt).not.toContain("知見: 0 件");
		expect(hyps.at(-1)!.prompt).toContain(
			"知見: 0 件（実行した試行 5 回のあと）",
		);
		const propose = prompts
			.filter((p) => p.purpose === "propose")
			.at(-1)!.prompt;
		expect(propose).toContain("（まだありません。実行した試行 5 回）");
		expect(propose).toContain("F番号で引用する");
	});
});
