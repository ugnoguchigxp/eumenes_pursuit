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
		// hz11i: the tally was printed twice (fixes-2026-10-22-e §3).
		expect(review).not.toMatch(/仮説1: 試行\d+回、予測と違う/);
		expect(review).toContain("## 戻った事情\n行き詰まりの可能性");
		expect(review).toContain(
			"この振り返りの対象（実行した試行 3 回: 反証の条件に当たらなかった 1・当たった 1・未判定 1。拒否 0 回）",
		);
	});
});

describe("hz11i follow-ups (spec/fixes-2026-10-22-e.md)", () => {
	const review = (over: Record<string, unknown> = {}) => ({
		decision: "continue_strategy",
		reason: "r",
		brokenAssumption: "段2の入力は CSV ではなく JSON",
		direction: "d",
		...over,
	});

	test("§2 a step back right after a met prediction is routine; §4 the reviewer's premise fix stays with the strategy", async () => {
		const { prompts, view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", {}, { ...empty, refutedIf: 'contains:"FAILED"' }),
					proposal("step_back", { ...empty, refutedIf: null }),
					proposal("give_up", { ...empty, refutedIf: null }),
				],
				review: [review()],
			},
			reviewer: true,
			conditions: { prediction: "falsifiable", findings: "all", review: true },
			policy: one,
			runtime: runtime({
				invoke: () => ({ status: "ok", output: "all passed", refs: [] }),
			}),
		});
		const rev = prompts.find((p) => p.purpose === "review");
		expect(rev?.prompt).toContain("## 戻った事情\n定例:");
		expect(rev?.system).toContain("routine");
		expect(rev?.system).not.toContain("stalled pursuit");
		const next = prompts.filter((p) => p.purpose === "hypothesize")[1]!.prompt;
		expect(next).toContain(
			"［振り返りでの前提の修正（方針の文面より優先）: 段2の入力は CSV ではなく JSON］",
		);
		expect(view.strategies[0]!.body).not.toContain("JSON");
	});

	test("§4 なし is not shown as a correction", async () => {
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("read", {}, empty),
					proposal("step_back", empty),
					proposal("give_up", empty),
				],
				review: [
					review({ brokenAssumption: "壊れた前提はない。注意点は既存テスト" }),
				],
			},
			reviewer: true,
			conditions: { findings: "all", review: true },
			policy: one,
		});
		const next = prompts.filter((p) => p.purpose === "hypothesize")[1]!.prompt;
		expect(next).not.toContain("振り返りでの前提の修正");
	});

	test("§5 the request says how a finding becomes 確認済み; §8 a tool's reread hint replaces the generic one", async () => {
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("probe", {}, empty),
					call("read", {}, empty),
					proposal("give_up", empty),
				],
			},
			conditions: { findings: "all" },
			policy: (p: any) => ({
				...one(p),
				observation: { latestChars: 100, olderChars: 50 },
			}),
			runtime: runtime({
				tools: [
					{
						name: "probe",
						description: "p",
						inputSchema: { type: "object", properties: {} },
						sideEffect: "none",
						permission: "data.read",
						reread:
							"全文は scratch/probe_log.jsonl にある（read_file で読める。呼び直すと回数を使う）",
					},
				],
				invoke: () => ({ status: "ok", output: "x".repeat(500), refs: [] }),
			}),
		});
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain(
			"生成側が記録した知見は、引用した試行が予測どおりでも、申告が合格しても未確認のまま",
		);
		expect(last).toContain("全文は scratch/probe_log.jsonl にある");
	});
});

describe("hz11j follow-ups (spec/fixes-2026-10-22-f.md)", () => {
	const keep = {
		decision: "continue_strategy",
		reason: "方針は健全で目標に向かっている。崩れたのは規則の一般化だけで、",
		brokenAssumption: "なし",
		direction: "方針1を続ける",
	};
	const two = (p: any) => ({
		...one(p),
		budget: { ...one(p).budget, strategies: 3, hypothesesPerStrategy: 1 },
	});

	test("§A continue_strategy at the hypothesis limit: a truthful re-plan, findings kept; §B the dead end is built from the record", async () => {
		const { prompts, view } = await run({
			script: {
				plan: [plan, plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call(
						"read",
						{},
						{
							...empty,
							findings: [
								{
									kind: "observation",
									statement: "方針の下の観測",
									scope: "strategy",
								},
							],
							refutedIf: 'contains:"FAILED"',
						},
					),
					proposal("step_back", { ...empty, refutedIf: null }),
					proposal("give_up", { ...empty, refutedIf: null }),
				],
				review: [keep],
			},
			reviewer: true,
			conditions: { prediction: "falsifiable", findings: "all", review: true },
			policy: two,
			runtime: runtime({
				invoke: () => ({ status: "ok", output: "2 FAILED", refs: [] }),
			}),
		});
		const plans = prompts.filter((p) => p.purpose === "plan");
		expect(plans).toHaveLength(2);
		const second = plans[1]!.prompt;
		expect(second).toContain(
			"仮説の上限（1 件）に達したため、規則で新しい方針として立て直す",
		);
		expect(second).not.toContain("これまでの方針はうまくいきませんでした");
		expect(view.strategies[0]!.closeReason).toContain(
			"方針の誤りによる終了ではない",
		);
		expect(
			view.findings.find((f) => f.statement === "方針の下の観測")!.status,
		).toBe("active");
		const dead = view.findings.filter((f) => f.kind === "dead_end");
		expect(dead).toHaveLength(1);
		expect(dead[0]!.statement).toContain(
			"成り立たないまま閉じた（実行した試行 1 回: 反証の条件に当たらなかった 0・当たった 1",
		);
		expect(dead[0]!.statement).toContain(
			"最後に実行した試行: #1 read → 反証の条件に当たった",
		);
		expect(dead[0]!.statement).not.toContain("方針は健全");
	});

	test("§C a refuted finding stays as one line with what replaced it; §D one tally format; §E budgets in the review", async () => {
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call(
						"probe",
						{},
						{
							...empty,
							findings: [
								{ kind: "lemma", statement: "規則は加算", scope: "pursuit" },
							],
						},
					),
					call(
						"probe",
						{},
						{
							...empty,
							findings: [
								{
									kind: "lemma",
									statement: "規則は加算と倍",
									scope: "pursuit",
								},
							],
							refute: [{ id: "F1", reason: "c で倍になる" }],
						},
					),
					proposal("step_back", empty),
					proposal("give_up", empty),
				],
				review: [keep],
			},
			reviewer: true,
			conditions: { findings: "all", review: true },
			policy: one,
			runtime: runtime({
				tools: [
					{
						name: "probe",
						description: "p",
						inputSchema: { type: "object", properties: {} },
						sideEffect: "none",
						permission: "data.read",
					},
				],
				invoke: () => ({
					status: "ok",
					output: { results: [], calls_left: 4 },
					refs: [],
				}),
			}),
		});
		const rev = prompts.find((p) => p.purpose === "review")!.prompt;
		expect(rev).toContain(
			"- F1 反証済み: 規則は加算 ／ 理由: c で倍になる［同じ一手で記録: F2］",
		);
		expect(rev).toContain("## 残りの予算（ホストが数えた値）");
		expect(rev).toContain("- probe: 残り 4 回（直近の観測の calls_left）");
		expect(rev).toMatch(/この仮説で 2\/\d+ 回/);
		const tally = /実行した試行 2 回: [^）]+/.exec(rev)![0];
		const later = prompts
			.filter((p) => p.purpose === "review")
			.map((p) => p.prompt);
		for (const p of later) expect(p).not.toContain("予測と違う/失敗");
		expect(view.findings.find((f) => f.seq === 1)!.status).toBe("refuted");
		expect(tally).toContain("拒否 0 回");
	});
});
