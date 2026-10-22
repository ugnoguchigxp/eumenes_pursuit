import { describe, expect, test } from "bun:test";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const empty = { findings: [], refute: [], uses: [] };
const one = (p: any) => ({
	...p,
	budget: { ...p.budget, strategies: 1, attemptsPerHypothesis: 20 },
	signals: { ...p.signals, consecutiveFailures: 50 },
});
const finding = (statement: string) => ({
	kind: "observation",
	statement,
	scope: "pursuit",
});

describe("hz11h follow-ups in the engine (spec/fixes-2026-10-22-d.md §3)", () => {
	test("§3.1 the host's unclipped text is stored and decides refutedIf", async () => {
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("read", {}, { ...empty, refutedIf: 'not_contains:"engine.py"' }),
					proposal("give_up", { ...empty, refutedIf: null }),
				],
			},
			conditions: { prediction: "falsifiable", findings: "all" },
			policy: one,
			runtime: runtime({
				invoke: () => ({
					status: "ok",
					output: { stdout: "a.py ...[省略]... z.py" },
					unclipped: ["a.py engine.py z.py"],
					refs: [],
				}),
			}),
		});
		expect(view.attempts[0]!.observation!.unclipped).toEqual([
			"a.py engine.py z.py",
		]);
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain(
			"判定: 反証の条件に当たらなかった（状態も予測どおり。表示は一部省略だが、判定は省略部分を含む全文で行った）",
		);
		expect(last).not.toContain("engine.py z.py");
	});

	test("§3.2 the request names the next F number; §3.3 a dangling F in a statement is marked", async () => {
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call(
						"read",
						{},
						{
							...empty,
							findings: [
								finding("a は F2 と同じ"),
								finding("b は F1 の続き、F9 も参照"),
							],
						},
					),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: one,
		});
		const first = prompts.find((p) => p.purpose === "propose")!.prompt;
		expect(first).toContain("次に記録される知見の番号は F1 から");
		const stated = view.findings.map((f) => f.statement);
		expect(stated).toContain("a は F2 と同じ");
		expect(stated).toContain(
			"b は F1 の続き、F9 も参照［注: F9 は記録の時点で台帳にない番号］",
		);
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain("次に記録される知見の番号は F3 から");
	});

	test("§3.5 a review request tallies the reviewed hypothesis's verdicts", async () => {
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("read", {}, { ...empty, refutedIf: 'contains:"FAILED"' }),
					call("read", {}, { ...empty, refutedIf: 'contains:"nope"' }),
					call("read", {}, { ...empty, refutedIf: "表が壊れていたら" }),
					proposal("give_up", { ...empty, refutedIf: null }),
				],
			},
			conditions: { prediction: "falsifiable", findings: "all" },
			policy: one,
			runtime: runtime({
				invoke: () => ({ status: "ok", output: "2 FAILED", refs: [] }),
			}),
		});
		const { reviewRequest } =
			await import("../../src/domains/generation/prompts.ts");
		const h = { ...view.hypotheses[0]!, result: null };
		const review = reviewRequest({
			view: { ...view, hypotheses: [h], currentHypothesisId: h.id },
			reason: "r",
			signals: [],
		}).prompt;
		expect(review).toContain(
			"この振り返りの対象（実行した試行 3 回: 反証の条件に当たらなかった 1・当たった 1・未判定 1）",
		);
	});
});
