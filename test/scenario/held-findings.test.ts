import { describe, expect, test } from "bun:test";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const empty = { findings: [], refute: [], uses: [] };
const one = (p: any) => ({
	...p,
	budget: { ...p.budget, strategies: 1, attemptsPerHypothesis: 20 },
	signals: { ...p.signals, consecutiveFailures: 50 },
});
const deadEnds = (view: Awaited<ReturnType<typeof run>>["view"]) =>
	view.findings.filter((f) => f.kind === "dead_end");

describe("a hypothesis that held is not a dead end (spec/fixes-2026-10-22-b.md §3)", () => {
	// hz11f-pursuit-r1 sales-pipeline H5/H6 (F17, F20): the last run matched the prediction and
	// its refutedIf ("status:error || not_contains:…") did not hold, the generator stepped back
	// to the next sub-problem, and v1.7 recorded 「仮説「…」は進まなかった」.
	const script = (refutedIf: string, status: "ok" | "error") => ({
		plan: [plan],
		hypothesize: [hypothesis, hypothesis],
		propose: [
			call("read", {}, { ...empty, refutedIf, expectedStatus: status }),
			proposal("step_back", { ...empty, refutedIf: null }),
			proposal("give_up", { ...empty, refutedIf: null }),
		],
	});
	const go = (refutedIf: string, status: "ok" | "error" = "ok") =>
		run({
			script: script(refutedIf, status),
			conditions: { prediction: "falsifiable", findings: "all" },
			policy: one,
			runtime: runtime({
				invoke: () => ({
					status: "ok",
					output: { text: "MAIN_MATCH 2025-03" },
					refs: [],
				}),
			}),
		});

	test("prediction met and refutation not held: no dead end", async () => {
		const { view } = await go('status:error || not_contains:"MAIN_MATCH"');
		expect(view.hypotheses[0]!.status).not.toBe("active");
		expect(deadEnds(view)).toHaveLength(0);
	});
	test("refutation held: a dead end is recorded", async () => {
		const { view } = await go('contains:"MAIN_MATCH"');
		expect(deadEnds(view).map((f) => f.statement)).toEqual([
			expect.stringContaining("進まなかった"),
		]);
	});
	test("no checkable refutation, or a missed status prediction: still a dead end", async () => {
		expect(deadEnds((await go("何かおかしな値が出たら")).view)).toHaveLength(1);
		expect(deadEnds((await go("status:error", "error")).view)).toHaveLength(1);
	});
});

describe("recorded findings are visible, or accurately reported (spec/fixes-2026-10-22-b.md §2)", () => {
	const finding = {
		kind: "observation",
		statement: "表の列は 5 つ",
		scope: "pursuit",
	};
	const go = (findings: "verified" | "all") =>
		run({
			script: {
				plan: [plan, plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", {}, { ...empty, findings: [finding] }),
					proposal("step_back", empty),
					call("read", {}, empty),
					proposal("give_up", empty),
				],
			},
			conditions: { findings, review: false },
			policy: (p: any) => ({
				...one(p),
				budget: { ...one(p).budget, strategies: 2 },
			}),
		});

	test("findings all: later hypothesize and propose prompts show the finding marked unverified", async () => {
		const { view, prompts } = await go("all");
		const f = view.findings.find((x) => x.kind === "observation")!;
		expect(f.assurance).toBe("unverified");
		const later = prompts.slice(
			prompts.findIndex((p) => p.prompt.includes("表の列は 5 つ")),
		);
		for (const purpose of ["hypothesize", "propose"] as const)
			expect(
				later.some(
					(p) =>
						p.purpose === purpose &&
						p.prompt.includes(`F${f.seq}`) &&
						p.prompt.includes("表の列は 5 つ") &&
						p.prompt.includes("未確認"),
				),
			).toBe(true);
		expect(prompts.some((p) => p.prompt.includes("（まだありません"))).toBe(
			true,
		);
		expect(later.some((p) => p.prompt.includes("（まだありません"))).toBe(
			false,
		);
	});

	test("findings verified: no false 「まだありません」; the hidden count and numbers are given", async () => {
		const { view, prompts } = await go("verified");
		const f = view.findings.find((x) => x.kind === "observation")!;
		const after = prompts.slice(
			prompts.findIndex((p, i) => i > 0 && p.purpose === "propose") + 1,
		);
		expect(after.length).toBeGreaterThan(0);
		for (const p of after) {
			expect(p.prompt).not.toContain("（まだありません。実行した試行");
			expect(p.prompt).toContain(`記録した未確認の知見 1 件（F${f.seq}）`);
			expect(p.prompt).not.toContain("表の列は 5 つ");
		}
	});
});

describe("clipped history text says how much was shown (spec/fixes-2026-10-22-b.md §4)", () => {
	test("no 「この一覧での表示はここまで」; the full length and the shown length instead", async () => {
		const long = "あ".repeat(3000);
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("read", {}, { expectedObservation: long, whatChanged: long }),
					proposal("give_up"),
				],
			},
			policy: one,
		});
		const last = prompts.at(-1)!.prompt;
		expect(last).not.toContain("この一覧での表示はここまで");
		expect(last).toMatch(
			/［表示は全 3000 字のうち先頭 \d+ 字。台帳には全文がある］/,
		);
	});
});

describe("hypothesis history and rejected moves (spec/fixes-2026-10-22-c.md §3-§5)", () => {
	test("a closed hypothesis names who decided; the reviewed one is not 試行中", async () => {
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", {}, empty),
					call("read", {}, empty),
					proposal("step_back", empty),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: one,
		});
		expect(view.hypotheses[0]!.result).toMatch(/^打ち切り（判断: [^）]+）: m$/);
		const next = prompts.filter((p) => p.purpose === "hypothesize")[1]!.prompt;
		expect(next).toContain("→ 打ち切り（判断: ");
		const { reviewRequest } =
			await import("../../src/domains/generation/prompts.ts");
		const v = { ...view, currentHypothesisId: view.hypotheses[1]!.id };
		const h1 = { ...view.hypotheses[1]!, result: null };
		const review = reviewRequest({
			view: { ...v, hypotheses: [view.hypotheses[0]!, h1] },
			reason: "r",
			signals: [],
		}).prompt;
		expect(review).toContain("この振り返りの対象（実行した試行");
		expect(review).not.toContain("→ 試行中");
	});

	test("a rejected move says the findings it carried were recorded", async () => {
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					proposal("step_back", {
						...empty,
						findings: [
							{ kind: "observation", statement: "列は 5 つ", scope: "pursuit" },
						],
						message: "F9 を根拠に戻る",
					}),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: one,
		});
		const rej = view.attempts.find((a) => a.state === "rejected")!;
		const detail = JSON.stringify(rej.rejection);
		expect(detail).toContain("finding_not_recorded");
		expect(detail).toContain("この提案の findings は台帳に記録済み: F1");
	});

	test("a finding is shown up to 800 characters", async () => {
		const long = "い".repeat(700);
		const { prompts } = await run({
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
								{ kind: "observation", statement: long, scope: "pursuit" },
							],
						},
					),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: one,
		});
		expect(prompts.at(-1)!.prompt).toContain(long);
	});
});
