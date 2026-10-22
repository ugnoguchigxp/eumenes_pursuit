import { describe, expect, test } from "bun:test";
import {
	createPursuitEngine,
	type CriterionResult,
	type JudgePort,
	type LlmPort,
	type LlmPurpose,
	type PursuitRuntime,
	type ToolDescriptor,
} from "../../src/index.ts";
import {
	hypothesisRequest,
	planRequest,
} from "../../src/domains/generation/prompts.ts";
import * as ledger from "../../src/domains/ledger/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";

/** Scripted answers per purpose; state-machine logic only, not a stand-in for live runs. */
function scripted(script: Partial<Record<LlmPurpose, unknown[]>>): LlmPort {
	return {
		async complete(request) {
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
const tool: ToolDescriptor = {
	name: "read",
	description: "",
	inputSchema: {},
	sideEffect: "none",
	permission: "data.read",
};
function runtime(
	passes: boolean,
	outcome: "ok" | "error" = "ok",
): PursuitRuntime {
	return {
		tools: {
			list: () => [tool],
			invoke: async () => ({ status: outcome, output: { v: 1 }, refs: [] }),
		},
		workspace: null,
		acceptance: {
			verify: async () => [
				{ id: "total", passed: passes, evidence: passes ? "ok" : "ng" },
			],
		},
	};
}
function setup(
	llm: LlmPort,
	judge: JudgePort | null = null,
	reviewer: LlmPort | null = null,
) {
	const store = openStore(":memory:", migrations);
	let n = 0;
	const engine = createPursuitEngine({
		store,
		clock: { now: () => 1000 + n },
		ids: { next: (p) => `${p}${n++}` },
		generator: llm,
		reviewer,
		judge,
	});
	return { store, engine };
}
async function drive(
	engine: ReturnType<typeof setup>["engine"],
	id: string,
	rt: PursuitRuntime,
	max = 40,
) {
	for (let i = 0; i < max; i++) {
		const r = await engine.step(id, rt, AbortSignal.timeout(5000));
		if (r.done || r.status === "awaiting_consultation") return r;
	}
	throw new Error("did_not_settle");
}
const conditions = (rules: boolean, judge = false) => ({
	...startInput().conditions,
	rules,
	judge,
});

describe("acceptance result contract", () => {
	const total = { id: "total", passed: true, evidence: "ok" };
	const consistent = { id: "consistent", passed: true, evidence: "ok" };
	const cases: {
		name: string;
		criteria: CriterionResult[];
		passed: boolean;
	}[] = [
		{ name: "missing criterion", criteria: [total], passed: false },
		{ name: "empty", criteria: [], passed: false },
		{
			name: "duplicate instead of missing",
			criteria: [total, total],
			passed: false,
		},
		{
			name: "duplicate in otherwise complete set",
			criteria: [total, consistent, total],
			passed: false,
		},
		{
			name: "unknown instead of expected",
			criteria: [total, { ...consistent, id: "other" }],
			passed: false,
		},
		{
			name: "extra unknown",
			criteria: [total, consistent, { ...total, id: "other" }],
			passed: false,
		},
		{ name: "all pass", criteria: [total, consistent], passed: true },
		{ name: "different order", criteria: [consistent, total], passed: true },
		{
			name: "failed criterion",
			criteria: [total, { ...consistent, passed: false }],
			passed: false,
		},
	];
	for (const trigger of ["claim", "attempt", "final"] as const)
		for (const row of cases)
			test(`${trigger}: ${row.name}`, async () => {
				const p =
					trigger === "claim"
						? proposal("done")
						: proposal("tool", {
								tool: "read",
								inputJson: "{}",
								expectedStatus: "ok",
								expectedObservation: "値が読める",
							});
				const { engine, store } = setup(
					scripted({ plan: [plan], hypothesize: [hypothesis], propose: [p] }),
				);
				try {
					const { pursuitId } = await engine.start(
						startInput({
							acceptance: [
								{ id: "total", text: "合計", method: "machine" },
								{ id: "consistent", text: "整合性", method: "machine" },
							],
						}),
						"k",
					);
					const rt = {
						...runtime(false),
						acceptance: { verify: async () => row.criteria },
					};
					if (trigger === "final")
						await engine.cancel(
							pursuitId,
							"停止",
							rt,
							new AbortController().signal,
						);
					else {
						await engine.step(pursuitId, rt, new AbortController().signal);
						await engine.step(pursuitId, rt, new AbortController().signal);
						await engine.step(pursuitId, rt, new AbortController().signal);
					}
					const view = (await engine.view(pursuitId))!;
					expect(view.verifications.at(-1)?.passed).toBe(row.passed);
					expect(view.status).toBe(
						trigger === "final"
							? "stopped"
							: row.passed
								? "completed"
								: "proposing",
					);
					if (view.report) expect(view.report.verified).toBe(row.passed);
					if (trigger === "claim" && !row.passed)
						expect(
							view.attempts.at(-1)?.rejection?.[0]?.detail.length,
						).toBeGreaterThan(0);
				} finally {
					store.close();
				}
			});
});

describe("engine", () => {
	for (const confidence of [0.1, 0.9])
		test(`progress confidence ${confidence} controls rule intervention`, async () => {
			let post = 0;
			const judge: JudgePort = {
				maxQuestions: 16,
				async ask(request) {
					return {
						answers: request.questions.progress
							? {
									progress: {
										type: "score" as const,
										score: 4 - post++,
										confidence,
										probabilities: [0.2, 0.2, 0.2, 0.2, 0.2],
									},
								}
							: {},
						model: "fixture",
						adapter: null,
						inputTokens: 1,
						latencyMs: 1,
					};
				},
			};
			const read = proposal("tool", {
				tool: "read",
				inputJson: "{}",
				expectedStatus: "ok",
				expectedObservation: "値が読める",
			});
			const { engine, store } = setup(
				scripted({
					plan: [plan],
					hypothesize: [hypothesis],
					propose: [read, read, read, read],
				}),
				judge,
			);
			try {
				const { pursuitId } = await engine.start(
					startInput({
						conditions: { ...conditions(true, true), verifyOn: "claim" },
					}),
					"k",
				);
				for (let i = 0; i < 6; i++)
					await engine.step(
						pursuitId,
						runtime(false),
						new AbortController().signal,
					);
				const view = (await engine.view(pursuitId))!;
				expect(view.status).toBe(confidence < 0.7 ? "proposing" : "reviewing");
				expect(
					view.decisions.some((d) => d.reason.includes("goal_drift")),
				).toBe(confidence >= 0.7);
				expect(
					view.judgements
						.filter((j) => j.questionId === "progress")
						.every((j) => j.usable),
				).toBe(confidence >= 0.7);
			} finally {
				store.close();
			}
		});
	test("review direction reaches the next hypothesis without reviving older directions", async () => {
		const direction = "未確認の境界値を先に調べる";
		const generator = scripted({
			plan: [plan],
			hypothesize: [hypothesis, hypothesis],
			propose: [proposal("step_back")],
		});
		const prompts: string[] = [];
		const { engine, store } = setup(
			{
				async complete(request, signal) {
					if (request.purpose === "hypothesize") prompts.push(request.prompt);
					return generator.complete(request, signal);
				},
			},
			null,
			scripted({
				review: [
					{
						decision: "continue_strategy",
						reason: "前提を確かめ直す",
						brokenAssumption: "不明",
						direction,
					},
				],
			}),
		);
		try {
			const { pursuitId } = await engine.start(
				startInput({ conditions: { ...conditions(true), review: true } }),
				"k",
			);
			for (let i = 0; i < 5; i++)
				await engine.step(
					pursuitId,
					runtime(false),
					new AbortController().signal,
				);
			expect(prompts).toHaveLength(2);
			expect(prompts[0]).not.toContain(direction);
			expect(prompts[1]).toContain(direction);
			const view = (await engine.view(pursuitId))!;
			const last = view.decisions.at(-1)!;
			const afterOtherDecision = {
				...view,
				decisions: [
					...view.decisions,
					{ ...last, id: "newer", kind: "consult" as const, basis: {} },
				],
			};
			expect(
				hypothesisRequest({ view: afterOtherDecision, tools: [tool] }).prompt,
			).not.toContain(direction);
		} finally {
			store.close();
		}
	});
	for (const issue of ["failed", "aborted"] as const)
		for (const ending of ["cancel", "budget", "give_up"] as const)
			test(`${ending} persists when final verification is ${issue}`, async () => {
				const { engine, store } = setup(
					scripted({
						plan: [plan],
						hypothesize: [hypothesis],
						propose: [proposal("give_up")],
					}),
				);
				try {
					const input = startInput();
					if (ending === "budget")
						input.policy = {
							...input.policy,
							budget: { ...input.policy.budget, transitions: 1 },
						};
					const { pursuitId } = await engine.start(input, "k");
					// cancel: the host's signal is already aborted. budget / give_up: W05 refuses to start
					// a step on an aborted signal, so the host aborts while the final verification runs.
					const controller = new AbortController();
					if (issue === "aborted" && ending === "cancel") controller.abort();
					const signal = controller.signal;
					let calls = 0;
					const rt = {
						...runtime(false),
						acceptance: {
							verify: async () => {
								calls++;
								if (issue === "aborted") {
									controller.abort();
									return new Promise<never>(() => {});
								}
								throw new Error("verifier unavailable");
							},
						},
					};
					if (ending === "give_up") {
						await engine.step(pursuitId, rt, new AbortController().signal);
						await engine.step(pursuitId, rt, new AbortController().signal);
					}
					const result =
						ending === "cancel"
							? await engine.cancel(pursuitId, "停止", rt, signal)
							: await engine.step(pursuitId, rt, signal);
					const view = (await engine.view(pursuitId))!;
					expect(result.done).toBe(true);
					expect(view.status).toBe(
						ending === "give_up" ? "incomplete" : "stopped",
					);
					expect(view.report?.verified).toBe(false);
					expect(view.report?.verificationIssue).toBe(issue);
					expect(view.verifications.at(-1)?.passed).toBe(false);
					expect(calls).toBe(
						issue === "aborted" && ending === "cancel" ? 0 : 1,
					);
				} finally {
					store.close();
				}
			});

	test("stopped is durable before verification returns, and abort ends an unresponsive verifier wait", async () => {
		const { engine, store } = setup(scripted({}));
		const controller = new AbortController();
		const entered = Promise.withResolvers<void>();
		const verification = Promise.withResolvers<readonly CriterionResult[]>();
		try {
			const { pursuitId } = await engine.start(startInput(), "k");
			const rt = {
				...runtime(false),
				acceptance: {
					verify: async () => {
						entered.resolve();
						return verification.promise;
					},
				},
			};
			const cancelling = engine.cancel(
				pursuitId,
				"停止",
				rt,
				controller.signal,
			);
			await entered.promise;
			const pending = (await engine.view(pursuitId))!;
			expect(pending.status).toBe("stopped");
			expect(pending.report?.verificationIssue).toBe("pending");
			expect((await engine.step(pursuitId, rt, controller.signal)).done).toBe(
				true,
			);
			controller.abort();
			expect((await cancelling).done).toBe(true);
			expect((await engine.view(pursuitId))?.report?.verificationIssue).toBe(
				"aborted",
			);
			// A late success cannot overwrite the aborted report.
			verification.resolve([{ id: "total", passed: true, evidence: "late" }]);
			await Promise.resolve();
			expect((await engine.view(pursuitId))?.report?.verified).toBe(false);
		} finally {
			verification.resolve([]);
			store.close();
		}
	});
	test("E0 accepts a completion claim without verification; the report says unverified", async () => {
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [proposal("done")],
			}),
		);
		const { pursuitId } = await engine.start(
			startInput({ conditions: conditions(false) }),
			"k",
		);
		const r = await drive(engine, pursuitId, runtime(false));
		const view = (await engine.view(pursuitId))!;
		expect(r.status).toBe("completed");
		expect(view.report?.verified).toBe(false);
	});

	test("with rules, a failing claim is rejected and repeated rejections step back", async () => {
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					proposal("done"),
					proposal("done"),
					proposal("done"),
					proposal("give_up"),
				],
			}),
		);
		const { pursuitId } = await engine.start(startInput(), "k");
		const r = await drive(engine, pursuitId, runtime(false));
		const view = (await engine.view(pursuitId))!;
		expect(
			view.attempts.filter(
				(a) => a.rejection?.[0]?.rule === "claim_not_verified",
			).length,
		).toBe(3);
		expect(view.decisions.map((d) => d.kind)).toEqual([
			"step_back",
			"change_hypothesis",
			"give_up",
		]);
		expect(r.status).toBe("incomplete");
	});

	test("with rules, completion comes only from host verification", async () => {
		const read = proposal("tool", {
			tool: "read",
			inputJson: "{}",
			expectedStatus: "ok",
			expectedObservation: "値が読める",
		});
		const { engine } = setup(
			scripted({ plan: [plan], hypothesize: [hypothesis], propose: [read] }),
		);
		const { pursuitId } = await engine.start(startInput(), "k");
		const r = await drive(engine, pursuitId, runtime(true));
		const view = (await engine.view(pursuitId))!;
		expect(r.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(view.decisions.at(-1)?.decidedBy).toBe("rules");
	});

	test("a judge 'continue' cannot undo a step back forced by the rules", async () => {
		const fail = proposal("tool", {
			tool: "read",
			inputJson: "{}",
			expectedStatus: "ok",
			expectedObservation: "値が読める",
		});
		const judge: JudgePort = {
			maxQuestions: 16,
			async ask(request) {
				const answers: Record<string, never> = {};
				const out: Record<string, unknown> = answers;
				for (const id of Object.keys(request.questions)) {
					if (id === "next")
						out[id] = {
							type: "choice",
							choice: "continue",
							confidence: 0.99,
							probabilities: {},
						};
					else if (id === "trajectory")
						out[id] = {
							type: "choice",
							choice: "progress",
							confidence: 0.99,
							probabilities: {},
						};
					else if (id === "match" || id === "progress")
						out[id] = {
							type: "score",
							score: 4,
							confidence: 0.9,
							probabilities: [0, 0, 0, 0.1, 0.9],
						};
					else
						out[id] = {
							type: "noul",
							pYes: id === "necessary" ? 0.99 : 0.01,
							confidence: 0.99,
						};
				}
				return {
					answers: out as never,
					model: "d1",
					adapter: null,
					inputTokens: 1,
					latencyMs: 1,
				};
			},
		};
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					...[1, 2, 3].map((n) => ({ ...fail, inputJson: `{"n":${n}}` })),
					proposal("give_up"),
				],
			}),
			judge,
		);
		const { pursuitId } = await engine.start(
			startInput({ conditions: conditions(true, true) }),
			"k",
		);
		await drive(engine, pursuitId, runtime(false, "error"));
		const view = (await engine.view(pursuitId))!;
		const kinds = view.decisions.map((d) => d.kind);
		expect(kinds).toContain("step_back");
		expect(kinds[kinds.indexOf("step_back") + 1]).toBe("change_hypothesis");
	});

	test("a started attempt left by a crash is marked interrupted on the next step", async () => {
		const { engine, store } = setup(
			scripted({ plan: [plan], hypothesize: [hypothesis] }),
		);
		const { pursuitId } = await engine.start(startInput(), "k");
		await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		const view = (await engine.view(pursuitId))!;
		await store.write((db) =>
			ledger.insertAttempt(db, {
				id: "crash",
				pursuitId,
				hypothesisId: view.currentHypothesisId!,
				state: "started",
				tool: "read",
				input: {},
				prediction: { expectedStatus: "ok", expectedObservation: "x" },
				whatChanged: "",
				fingerprint: "f",
				rejection: null,
				now: 1,
			}),
		);
		const r = await engine.step(
			pursuitId,
			runtime(false),
			AbortSignal.timeout(5000),
		);
		expect(r.event).toBe("interrupted");
		expect(
			(await engine.view(pursuitId))!.attempts.find((a) => a.id === "crash")
				?.state,
		).toBe("interrupted");
	});

	test("raw text reaches the tool's text field without JSON escaping", async () => {
		const tex = String.raw`$\frac{a}{b}$ と "引用" \n`;
		const write: ToolDescriptor = {
			...tool,
			name: "write",
			textField: "content",
		};
		let received: unknown;
		const rt: PursuitRuntime = {
			...runtime(false),
			tools: {
				list: () => [write],
				invoke: async (call) => {
					received = call.input.content;
					return { status: "ok", output: null, refs: [] };
				},
			},
		};
		const p = proposal("tool", {
			tool: "write",
			inputJson: "{}",
			expectedStatus: "ok",
			expectedObservation: "書ける",
			text: tex,
		});
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [p, proposal("give_up")],
			}),
		);
		const { pursuitId } = await engine.start(startInput(), "k");
		await drive(engine, pursuitId, rt);
		expect(received).toBe(tex);
	});

	test("protective restore keeps work after a plain failure streak, always-restore rolls back", async () => {
		for (const [mode, expected] of [
			["protective", 0],
			["always", 1],
		] as const) {
			let restores = 0;
			const rt: PursuitRuntime = {
				...runtime(false, "error"),
				workspace: {
					checkpoint: async () => "1",
					restore: async () => {
						restores++;
					},
					digest: async () => "d",
					changesSince: async () => ({
						filesTouched: [],
						linesChanged: 0,
						protectedTouched: [],
					}),
				},
			};
			const fail = proposal("tool", {
				tool: "read",
				expectedStatus: "ok",
				expectedObservation: "読める",
			});
			const { engine } = setup(
				scripted({
					plan: [plan],
					hypothesize: [hypothesis, hypothesis],
					propose: [
						...[1, 2, 3].map((n) => ({ ...fail, inputJson: `{"n":${n}}` })),
						proposal("give_up"),
					],
				}),
			);
			const base = startInput();
			const { pursuitId } = await engine.start(
				{ ...base, policy: { ...base.policy, restore: mode } },
				`k-${mode}`,
			);
			await drive(engine, pursuitId, rt);
			expect(restores).toBe(expected);
		}
	});

	describe("findings", () => {
		const read = proposal("tool", {
			tool: "read",
			inputJson: "{}",
			expectedStatus: "ok",
			expectedObservation: "読める",
		});
		function capture(script: Partial<Record<LlmPurpose, unknown[]>>) {
			const prompts: string[] = [];
			const inner = scripted(script);
			const llm: LlmPort = {
				complete: (request, signal) => {
					prompts.push(request.prompt);
					return inner.complete(request, signal);
				},
			};
			return { llm, prompts };
		}
		const lemmaCheck: PursuitRuntime = {
			...runtime(false),
			acceptance: {
				verify: async () => [
					{
						id: "total",
						passed: false,
						evidence: "ng",
						assurance: "model",
						findings: [
							{
								kind: "lemma",
								statement: "補題A は成り立つ",
								assurance: "model",
							},
						],
					},
				],
			},
		};
		const declared = {
			...read,
			findings: [
				{
					kind: "observation",
					statement: "値は 3 だった",
					scope: "hypothesis",
				},
			],
			refute: [],
			uses: [],
		};

		for (const mode of ["verified", "all"] as const)
			test(`${mode}: declared claims are kept as unverified, claim checks as model, closed hypotheses as dead ends`, async () => {
				const { llm, prompts } = capture({
					plan: [plan],
					hypothesize: [hypothesis, hypothesis],
					propose: [
						declared,
						// Only a completion claim's check may yield findings.
						{ ...proposal("done"), findings: [], refute: [], uses: [] },
						{
							...proposal("step_back"),
							findings: [],
							refute: [
								{ id: "F2", reason: "誤り" },
								{ id: "F1", reason: "検査済みは反駁できない" },
							],
							uses: [],
						},
						{ ...proposal("give_up"), findings: [], refute: [], uses: [] },
					],
				});
				const { engine } = setup(llm);
				const base = startInput();
				const { pursuitId } = await engine.start(
					{ ...base, conditions: { ...base.conditions, findings: mode } },
					`k-${mode}`,
				);
				await drive(engine, pursuitId, lemmaCheck);
				const view = (await engine.view(pursuitId))!;
				const byKind = view.findings.map((f) => [
					f.kind,
					f.assurance,
					f.status,
				]);
				expect(byKind).toContainEqual(["lemma", "model", "active"]);
				expect(byKind).toContainEqual(["observation", "unverified", "refuted"]);
				expect(byKind).toContainEqual(["dead_end", "exact", "active"]);
				expect(view.report?.findings.checked.map((f) => f.statement)).toEqual([
					"補題A は成り立つ",
				]);
				const later = prompts.at(-1) ?? "";
				expect(later).toContain("補題A は成り立つ");
				expect(later).toContain("行き止まり");
			});

		test("verified hides unverified claims from later prompts; all shows them labelled", async () => {
			for (const mode of ["verified", "all"] as const) {
				const { llm, prompts } = capture({
					plan: [plan],
					hypothesize: [hypothesis],
					propose: [
						declared,
						{ ...proposal("give_up"), findings: [], refute: [], uses: [] },
					],
				});
				const { engine } = setup(llm);
				const base = startInput();
				const { pursuitId } = await engine.start(
					{ ...base, conditions: { ...base.conditions, findings: mode } },
					`v-${mode}`,
				);
				await drive(engine, pursuitId, runtime(false));
				const last = prompts.at(-1) ?? "";
				if (mode === "verified") expect(last).not.toContain("値は 3 だった");
				else expect(last).toContain("[observation・未確認");
			}
		});

		test("per-attempt checks record no findings (the hidden grader would leak)", async () => {
			const { engine } = setup(
				scripted({
					plan: [plan],
					hypothesize: [hypothesis],
					propose: [
						declared,
						{ ...proposal("give_up"), findings: [], refute: [], uses: [] },
					],
				}),
			);
			const base = startInput();
			const { pursuitId } = await engine.start(
				{ ...base, conditions: { ...base.conditions, findings: "verified" } },
				"leak",
			);
			await drive(engine, pursuitId, lemmaCheck);
			const view = (await engine.view(pursuitId))!;
			expect(view.verifications.map((v) => v.trigger)).toContain("attempt");
			expect(view.findings.filter((f) => f.kind === "lemma")).toEqual([]);
		});

		test("off records nothing and keeps the baseline proposal schema", async () => {
			const { llm, prompts } = capture({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [proposal("give_up")],
			});
			const { engine } = setup(llm);
			const { pursuitId } = await engine.start(startInput(), "off");
			await drive(engine, pursuitId, lemmaCheck);
			expect((await engine.view(pursuitId))!.findings).toEqual([]);
			expect(prompts.join("\n")).not.toContain("## 知見");
		});
	});

	test("operation keys replay the same start and refuse a different one", async () => {
		const { engine } = setup(scripted({}));
		const a = await engine.start(startInput(), "same");
		expect(await engine.start(startInput(), "same")).toEqual({
			pursuitId: a.pursuitId,
			replayed: true,
		});
		expect(
			engine.start(startInput({ goal: "別の目標" }), "same"),
		).rejects.toThrow("operation_conflict");
	});
});

describe("strategy change", () => {
	async function viewAfterPlan(strategyChange: "free" | "distinct") {
		const { engine } = setup(scripted({ plan: [plan] }));
		const { pursuitId } = await engine.start(
			startInput({
				conditions: { ...startInput().conditions, strategyChange },
			}),
			`k-${strategyChange}`,
		);
		await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		return (await engine.view(pursuitId))!;
	}

	test("distinct asks for a different core idea and offers untried alternatives back", async () => {
		const prompt = planRequest({
			view: await viewAfterPlan("distinct"),
			tools: [tool],
			direction: null,
		}).prompt;
		expect(prompt).toContain(
			"## これまでに挙げた別案（採ったものを除いて検討する）\n- 別案",
		);
		expect(prompt).toContain("核となる考え方");
	});

	test("free keeps the v1 request", async () => {
		const prompt = planRequest({
			view: await viewAfterPlan("free"),
			tools: [tool],
			direction: null,
		}).prompt;
		expect(prompt).not.toContain("## これまでに挙げた別案");
		expect(prompt).toContain("別の方針を一つ立ててください");
	});
});

describe("self-check (parts)", () => {
	const planWithParts = { ...plan, parts: ["構成", "評価"] };
	const assess = (statuses: [string, string][]) =>
		statuses.map(([status, next], i) => ({
			part: i + 1,
			status,
			evidence: "e",
			next,
		}));
	const withParts = (extra: Record<string, unknown> = {}) =>
		startInput({
			conditions: { ...startInput().conditions, selfCheck: "parts" },
			...extra,
		});
	const read = proposal("tool", {
		tool: "read",
		inputJson: "{}",
		expectedStatus: "ok",
		expectedObservation: "値が読める",
		assessment: [],
	});

	test("give up needs an assessment, and is refused while a part is untried", async () => {
		const { engine } = setup(
			scripted({
				plan: [planWithParts],
				hypothesize: [hypothesis],
				propose: [
					proposal("give_up", { assessment: [] }),
					proposal("give_up", {
						assessment: assess([
							["done", ""],
							["untried", ""],
						]),
					}),
					read,
				],
			}),
		);
		const { pursuitId } = await engine.start(withParts(), "k");
		for (let i = 0; i < 5; i++)
			await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		const view = (await engine.view(pursuitId))!;
		expect(view.attempts.map((a) => a.rejection?.[0]?.rule ?? a.tool)).toEqual([
			"assessment_missing",
			"strategy_not_exhausted",
			"read",
		]);
		expect(view.strategies[0]?.parts).toEqual(["構成", "評価"]);
		expect(view.strategies[0]?.assessment?.[1]?.status).toBe("untried");
	});

	test("an exhausted strategy with strategies left turns give up into a step back", async () => {
		const { engine } = setup(
			scripted({
				plan: [planWithParts],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					proposal("give_up", {
						assessment: assess([
							["done", ""],
							["blocked", ""],
						]),
					}),
					proposal("give_up", {
						assessment: assess([
							["done", ""],
							["blocked", ""],
						]),
					}),
				],
			}),
		);
		const { pursuitId } = await engine.start(withParts(), "k");
		for (let i = 0; i < 4; i++)
			await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		const view = (await engine.view(pursuitId))!;
		expect(view.decisions[0]).toMatchObject({
			kind: "step_back",
			decidedBy: "rules",
		});
	});

	test("the review cannot drop a strategy whose parts are unfinished", async () => {
		const review = {
			decision: "change_strategy",
			reason: "r",
			brokenAssumption: "",
			direction: "別の方針",
		};
		const { engine } = setup(
			scripted({
				plan: [planWithParts],
				hypothesize: [hypothesis],
				propose: [
					proposal("step_back", {
						assessment: assess([
							["blocked", "係数を整数にする"],
							["untried", ""],
						]),
					}),
				],
			}),
			null,
			scripted({ review: [review] }),
		);
		const { pursuitId } = await engine.start(
			withParts({
				conditions: {
					...startInput().conditions,
					selfCheck: "parts",
					review: true,
				},
			}),
			"k",
		);
		for (let i = 0; i < 4; i++)
			await engine.step(pursuitId, runtime(false), AbortSignal.timeout(5000));
		const view = (await engine.view(pursuitId))!;
		const decision = view.decisions[1]!;
		expect(decision.kind).toBe("change_hypothesis");
		expect(decision.decidedBy).toBe("rules");
		expect(decision.basis.escalation).toEqual(["strategy_not_exhausted"]);
		expect(String(decision.basis.direction)).toContain("係数を整数にする");
		expect(view.strategies).toHaveLength(1);
	});
});

describe("consultation without progress", () => {
	test("with requireProgress, a second consultation needs an attempt in between", async () => {
		const consultProposal = proposal("consult", { missing: "情報" });
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [consultProposal, consultProposal],
			}),
		);
		const { pursuitId } = await engine.start(
			startInput({
				policy: {
					...startInput().policy,
					consultation: { requireProgress: true },
				},
			}),
			"k",
		);
		const rt = runtime(false);
		const asked = await drive(engine, pursuitId, rt);
		expect(asked.status).toBe("awaiting_consultation");
		const open = (await engine.view(pursuitId))!.consultations[0]!;
		await engine.answer(pursuitId, open.id, "追加情報はありません");
		await engine.step(pursuitId, rt, AbortSignal.timeout(5000));
		const view = (await engine.view(pursuitId))!;
		expect(view.consultations).toHaveLength(1);
		expect(view.attempts.at(-1)?.rejection?.[0]?.rule).toBe(
			"consult_without_progress",
		);
	});
});

describe("verification timing and predictions", () => {
	const read = proposal("tool", {
		tool: "read",
		inputJson: "{}",
		expectedStatus: "ok",
		expectedObservation: "読める",
	});
	async function run(
		overrides: Partial<ReturnType<typeof startInput>["conditions"]>,
		propose: unknown[],
	) {
		const { engine } = setup(
			scripted({ plan: [plan], hypothesize: [hypothesis], propose }),
		);
		const base = startInput();
		const { pursuitId } = await engine.start(
			{ ...base, conditions: { ...base.conditions, ...overrides } },
			"k",
		);
		await drive(engine, pursuitId, runtime(true));
		return (await engine.view(pursuitId))!;
	}

	test("attempt: a passing check after an attempt completes without a claim", async () => {
		const view = await run({}, [read]);
		expect(view.status).toBe("completed");
		expect(view.verifications.map((v) => v.trigger)).toEqual([
			"attempt",
			"final",
		]);
	});

	test("claim: nothing is checked until the generator claims completion", async () => {
		const view = await run({ verifyOn: "claim" }, [read, proposal("done")]);
		expect(view.status).toBe("completed");
		expect(view.verifications.map((v) => v.trigger)).toEqual([
			"claim",
			"final",
		]);
	});

	test("claim: a spent hypothesis whose last attempt succeeded may still claim", async () => {
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [read, proposal("done")],
			}),
		);
		const base = startInput();
		const { pursuitId } = await engine.start(
			{
				...base,
				policy: {
					...base.policy,
					budget: { ...base.policy.budget, attemptsPerHypothesis: 1 },
				},
				conditions: { ...base.conditions, verifyOn: "claim" },
			},
			"k",
		);
		await drive(engine, pursuitId, runtime(true));
		expect((await engine.view(pursuitId))!.status).toBe("completed");
	});

	test("falsifiable: refutedIf must be present and differ from the prediction", async () => {
		const view = await run({ prediction: "falsifiable" }, [
			{ ...read, refutedIf: null },
			{ ...read, refutedIf: "読める" },
			{ ...read, refutedIf: "エラーになる" },
		]);
		expect(view.attempts.map((a) => a.rejection?.[0]?.rule ?? a.state)).toEqual(
			["prediction_not_falsifiable", "prediction_not_falsifiable", "settled"],
		);
		expect(view.attempts.at(-1)?.prediction.refutedIf).toBe("エラーになる");
	});
});

describe("completion check (acceptance)", () => {
	const writer: ToolDescriptor = {
		name: "write",
		description: "",
		inputSchema: {},
		sideEffect: "workspace",
		permission: "data.read",
	};
	const reader: ToolDescriptor = {
		name: "read_back",
		description: "",
		inputSchema: {},
		sideEffect: "none",
		readsWorkspace: true,
		readsBack: true,
		permission: "data.read",
	};
	const rt: PursuitRuntime = {
		tools: {
			list: () => [writer, reader],
			invoke: async () => ({
				status: "ok",
				output: { content: "全文" },
				refs: [],
			}),
		},
		workspace: null,
		acceptance: {
			verify: async () => [{ id: "total", passed: true, evidence: "ok" }],
		},
	};
	const use = (name: string) =>
		proposal("tool", {
			tool: name,
			inputJson: "{}",
			expectedStatus: "ok",
			expectedObservation: "書ける",
			acceptanceCheck: [],
		});
	const stepBack = (met: boolean | null) =>
		proposal("step_back", {
			acceptanceCheck:
				met === null ? [] : [{ id: "total", met, where: "第2節" }],
		});

	test("re-read first, judge every criterion, and claim when all are met", async () => {
		const { engine } = setup(
			scripted({
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					use("write"),
					stepBack(false),
					use("read_back"),
					stepBack(null),
					stepBack(true),
					proposal("done", { acceptanceCheck: [] }),
				],
			}),
		);
		const base = startInput();
		const { pursuitId } = await engine.start(
			{
				...base,
				conditions: {
					...base.conditions,
					verifyOn: "claim",
					completionCheck: "acceptance",
				},
			},
			"k",
		);
		await drive(engine, pursuitId, rt);
		const view = (await engine.view(pursuitId))!;
		expect(view.attempts.map((a) => a.rejection?.[0]?.rule ?? a.tool)).toEqual([
			"write",
			"reread_required",
			"read_back",
			"acceptance_check_missing",
			"claim_suggested",
		]);
		expect(view.verifications.map((v) => v.trigger)).toEqual([
			"claim",
			"final",
		]);
		expect(view.status).toBe("completed");
	});
});
