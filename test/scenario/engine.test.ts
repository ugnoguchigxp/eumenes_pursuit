import { describe, expect, test } from "bun:test";
import {
	createPursuitEngine,
	type JudgePort,
	type LlmPort,
	type LlmPurpose,
	type PursuitRuntime,
	type ToolDescriptor,
} from "../../src/index.ts";
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
function setup(llm: LlmPort, judge: JudgePort | null = null) {
	const store = openStore(":memory:", migrations);
	let n = 0;
	const engine = createPursuitEngine({
		store,
		clock: { now: () => 1000 + n },
		ids: { next: (p) => `${p}${n++}` },
		generator: llm,
		reviewer: null,
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

describe("engine", () => {
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
