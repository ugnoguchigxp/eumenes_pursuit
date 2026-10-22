import { describe, expect, test } from "bun:test";
import { citationNote } from "../../src/domains/loop/engine.ts";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const empty = { findings: [], refute: [], uses: [] };
const one = (p: any) => ({
	...p,
	budget: { ...p.budget, strategies: 1, attemptsPerHypothesis: 20 },
	signals: { ...p.signals, consecutiveFailures: 50 },
});
const keep = {
	decision: "continue_strategy",
	reason: "続ける",
	brokenAssumption: "なし",
	direction: "方針1を続ける",
};

describe("hz11k follow-ups (spec/fixes-2026-10-22-g.md)", () => {
	test("§3 older observations get olderChars everywhere, inputs are labelled; §5 the hypothesis cap is told; §8 numbering note", async () => {
		const long = "x".repeat(1500);
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", { big: "y".repeat(700) }),
					call("read"),
					proposal("step_back"),
					proposal("give_up"),
				],
			},
			policy: one,
			runtime: runtime({
				invoke: () => ({ status: "ok", output: long, refs: [] }),
			}),
		});
		const hyp = prompts.filter((p) => p.purpose === "hypothesize");
		expect(hyp[0]!.prompt).toMatch(/この方針で立てる仮説は 1\/\d+ 件目/);
		const second = hyp[1]!.prompt;
		expect(second).toContain("## 直近の試行");
		// The older observation (1502 chars of JSON) fits olderChars (1800): not clipped at 900.
		expect(second).not.toContain("先頭 900 字");
		expect(second).toContain(long);
		expect(second).toContain("（観測ではない）");
		expect(second).toContain("#番号はこの課題の試行の通し番号");
	});

	test("§6 findings oldest first with the numbering note; §7 the re-record path; §10 citation check", async () => {
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
								{
									kind: "observation",
									statement: "料金は 120 円",
									scope: "pursuit",
								},
								{ kind: "observation", statement: "税は別", scope: "pursuit" },
							],
						},
					),
					call(
						"read",
						{},
						{
							...empty,
							refute: [{ id: "F1", reason: "F2 によれば 150 円" }],
						},
					),
					call("read", {}, empty),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: one,
			runtime: runtime(),
		});
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain("番号の古い順");
		expect(last).toContain(
			"同じ主張を根拠の試行とともに新しい知見として記録し直す",
		);
		expect(last).toContain(
			"この一手の findings は書いた順に F3, F4, F5 になる",
		);
		const f1 = view.findings.find((f) => f.seq === 1)!;
		expect(f1.status).toBe("refuted");
		expect(f1.reason).toContain("F2 の本文に、理由の語や数値が見当たらない");
	});

	test("§10 citationNote: unknown, self and matching citations", () => {
		const fs = [
			{ seq: 1, statement: "料金は 120 円" },
			{ seq: 2, statement: "料金は 150 円に改定" },
		];
		expect(citationNote("F2 によれば 150 円", 1, fs)).toBe("");
		expect(citationNote("F9 のとおり", 1, fs)).toContain("F9 は台帳にない番号");
		expect(citationNote("F1 は誤り", 1, fs)).toContain(
			"F1 は反証する知見そのもの",
		);
		expect(citationNote("料金の規則が違う", 1, fs)).toBe("");
	});

	test("§9 a 済み part after read-only attempts is noted for the reviewer", async () => {
		const { prompts } = await run({
			script: {
				plan: [{ ...plan, parts: ["スクリプトを実行して確かめる"] }],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", {}, { assessment: [] }),
					proposal("step_back", {
						assessment: [
							{ part: 1, status: "done", evidence: "読んだ", next: "" },
						],
					}),
					proposal("give_up", {
						assessment: [
							{ part: 1, status: "done", evidence: "読んだ", next: "" },
						],
					}),
				],
				review: [keep],
			},
			reviewer: true,
			conditions: { selfCheck: "parts", review: true },
			policy: one,
			runtime: runtime(),
		});
		const rev = prompts.find((p) => p.purpose === "review")!.prompt;
		expect(rev).toContain("## 自己評価についてのホストの注記");
		expect(rev).toContain(
			"部品1は済みとされたが、この方針で実行した試行 1 回はすべて読むだけの道具（read）",
		);
	});
});
