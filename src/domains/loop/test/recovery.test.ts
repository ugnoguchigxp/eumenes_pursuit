import { proposalRequest } from "../../generation/prompts.ts";
import { expect, test } from "bun:test";
import {
	createPursuitEngine,
	type LlmPort,
	type JudgePort,
	type PursuitRuntime,
} from "../../../index.ts";
import { migrations } from "../../../sqlite.ts";
import { openStore } from "../../../../standalone/store.ts";
import { startInput } from "../../../../test/support.ts";

async function fixture(
	judge: JudgePort | null = null,
	options: { advanceAt?: string; findings?: boolean } = {},
) {
	const store = openStore(":memory:", migrations);
	let n = 0;
	let now = 1000;
	const tool = {
		name: "read",
		description: "",
		inputSchema: {},
		sideEffect: "none" as const,
		permission: "data.read",
	};
	const llm: LlmPort = {
		async complete(r) {
			if (r.purpose === options.advanceAt)
				now += startInput().policy.budget.wallMs + 1;
			const v =
				r.purpose === "plan"
					? { strategy: "s", rationale: "r", alternatives: [] }
					: r.purpose === "hypothesize"
						? {
								hypothesis: "h",
								rationale: "r",
								tools: ["read"],
								expected: "e",
							}
						: {
								kind: "tool",
								tool: "read",
								inputJson: "{}",
								whatChanged: "",
								expectedStatus: "ok",
								expectedObservation: "result",
								text: null,
								message: "",
								missing: "",
								...(options.findings
									? { findings: [], refute: [], uses: [] }
									: {}),
							};
			return {
				value: r.schema.parse(v),
				model: "fake",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const engine = createPursuitEngine({
		store,
		clock: { now: () => now },
		ids: { next: (p) => p + n++ },
		generator: llm,
		reviewer: null,
		judge,
	});
	let invoked = 0;
	const rt: PursuitRuntime = {
		tools: {
			list: () => [tool],
			invoke: async () => {
				invoked++;
				return { status: "ok", output: { ok: true }, refs: [] };
			},
		},
		workspace: null,
		acceptance: {
			verify: async () => [{ id: "total", passed: false, evidence: "no" }],
		},
	};
	const base = startInput();
	const { pursuitId: id } = await engine.start(
		{
			...base,
			conditions: {
				...base.conditions,
				judge: judge !== null,
				findings: options.findings ? "verified" : "off",
			},
		},
		"start",
	);
	for (let i = 0; i < 2; i++)
		await engine.step(id, rt, new AbortController().signal);
	return {
		store,
		engine,
		id,
		rt,
		invoked: () => invoked,
		setNow: (v: number) => {
			now = v;
		},
	};
}
test("aborted post-check is recovered before another proposal or tool", async () => {
	const abort = new AbortController();
	let calls = 0;
	const judge: JudgePort = {
		maxQuestions: 20,
		async ask() {
			calls++;
			if (calls === 2) {
				abort.abort();
				throw new Error("aborted");
			}
			return {
				answers: {},
				model: "fake",
				adapter: null,
				inputTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const f = await fixture(judge);
	try {
		await expect(f.engine.step(f.id, f.rt, abort.signal)).rejects.toThrow();
		expect(f.invoked()).toBe(1);
		expect((await f.engine.view(f.id))!.attempts[0]!.settlement!.stage).toBe(
			"need_post_judge",
		);
		await f.engine.step(f.id, f.rt, new AbortController().signal);
		expect(f.invoked()).toBe(1);
		expect((await f.engine.view(f.id))!.attempts[0]!.settlement!.stage).toBe(
			"done",
		);
		expect((await f.engine.view(f.id))!.verifications).toHaveLength(1);
	} finally {
		f.store.close();
	}
});
test("saved acceptance is not repeated when resuming rule application", async () => {
	const f = await fixture();
	try {
		await f.engine.step(f.id, f.rt, new AbortController().signal);
		const view = (await f.engine.view(f.id))!;
		await f.store.write((db) => {
			db.query(
				"UPDATE pursuit_attempt SET settlement_json = ? WHERE id = ?",
			).run(
				JSON.stringify({ stage: "need_rules", digest: null, effects: null }),
				view.attempts[0]!.id,
			);
		});
		let verifies = 0;
		const rt = {
			...f.rt,
			acceptance: {
				verify: async () => {
					verifies++;
					throw new Error("should not verify");
				},
			},
		};
		await f.engine.step(f.id, rt, new AbortController().signal);
		expect(f.invoked()).toBe(1);
		expect(verifies).toBe(0);
	} finally {
		f.store.close();
	}
});

test("generation that outlives wall budget cannot start a tool", async () => {
	const f = await fixture(null, { advanceAt: "propose" });
	try {
		const result = await f.engine.step(
			f.id,
			f.rt,
			new AbortController().signal,
		);
		expect(result.status).toBe("stopped");
		expect(f.invoked()).toBe(0);
		expect((await f.engine.view(f.id))!.report!.verificationIssue).toBe(
			"aborted",
		);
	} finally {
		f.store.close();
	}
});
test("later checked evidence is kept beside an unverified claim", async () => {
	const f = await fixture(null, { findings: true });
	try {
		const claim = {
			kind: "lemma" as const,
			statement: "a reusable claim",
			scope: "pursuit" as const,
			strategyId: null,
			hypothesisId: null,
		};
		await f.store.write((db) => {
			db.query(
				"INSERT INTO pursuit_finding (id,pursuit_id,seq,kind,statement,assurance,scope,status,created_at) VALUES (?,?,1,'lemma',?,'unverified','pursuit','active',1)",
			).run("prior", f.id, claim.statement);
		});
		const rt = {
			...f.rt,
			tools: {
				...f.rt.tools,
				invoke: async () => ({
					status: "ok" as const,
					output: null,
					refs: [],
					findings: [
						{
							kind: "lemma" as const,
							statement: claim.statement,
							assurance: "model" as const,
						},
						{
							kind: "lemma" as const,
							statement: claim.statement,
							assurance: "model" as const,
						},
					],
				}),
			},
		};
		await f.engine.step(f.id, rt, new AbortController().signal);
		const v = (await f.engine.view(f.id))!;
		expect(v.findings.map((x) => x.assurance)).toEqual(["unverified", "model"]);
		const prompt = proposalRequest({
			view: v,
			tools: rt.tools.list(),
			feedback: null,
		}).prompt;
		expect(prompt).toContain("a reusable claim");
		expect(prompt).toContain("F2");
		expect(prompt).not.toContain("F1 [lemma");
	} finally {
		f.store.close();
	}
});

test("post-judge expiry still preserves the tool result and closes pending work", async () => {
	let f: Awaited<ReturnType<typeof fixture>>;
	let calls = 0;
	const judge: JudgePort = {
		maxQuestions: 20,
		async ask() {
			if (++calls === 2) f.setNow(1000 + startInput().policy.budget.wallMs + 1);
			return {
				answers: {},
				model: "fake",
				adapter: null,
				inputTokens: 0,
				latencyMs: 0,
			};
		},
	};
	f = await fixture(judge);
	try {
		const r = await f.engine.step(f.id, f.rt, new AbortController().signal);
		expect(r.status).toBe("stopped");
		const v = (await f.engine.view(f.id))!;
		expect(v.attempts).toHaveLength(1);
		expect(v.attempts[0]!.observation!.status).toBe("ok");
		expect(v.attempts[0]!.settlement!.stage).toBe("done");
	} finally {
		f.store.close();
	}
});
test("a recovered protected-touch alarm intervenes before another tool", async () => {
	const abort = new AbortController();
	let calls = 0;
	const judge: JudgePort = {
		maxQuestions: 20,
		async ask() {
			if (++calls === 2) {
				abort.abort();
				throw new Error("abort");
			}
			return {
				answers: {},
				model: "fake",
				adapter: null,
				inputTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const f = await fixture(judge);
	try {
		await expect(f.engine.step(f.id, f.rt, abort.signal)).rejects.toThrow();
		await f.store.write((db) =>
			db
				.query(
					"UPDATE pursuit_attempt SET features_json = ? WHERE pursuit_id = ?",
				)
				.run(
					JSON.stringify({
						filesTouched: ["test/protected.ts"],
						linesChanged: 1,
						protectedTouched: ["test/protected.ts"],
						match: null,
						progress: null,
					}),
					f.id,
				),
		);
		const r = await f.engine.step(f.id, f.rt, new AbortController().signal);
		expect(r.status).toBe("reviewing");
		expect(f.invoked()).toBe(1);
		expect((await f.engine.view(f.id))!.attempts[0]!.settlement!.stage).toBe(
			"done",
		);
	} finally {
		f.store.close();
	}
});

for (const effectHappened of [false, true])
	test(`interrupted tool (effect=${effectHappened}) remains unknown and cannot blindly repeat`, async () => {
		const f = await fixture();
		const abort = new AbortController();
		let effects = 0;
		try {
			const rt = {
				...f.rt,
				tools: {
					...f.rt.tools,
					invoke: async () => {
						if (effectHappened) effects++;
						abort.abort();
						throw new Error("interrupted");
					},
				},
			};
			await expect(f.engine.step(f.id, rt, abort.signal)).rejects.toThrow();
			const recovered = await f.engine.step(
				f.id,
				f.rt,
				new AbortController().signal,
			);
			expect(recovered.event).toBe("interrupted");
			expect((await f.engine.view(f.id))!.attempts[0]!.outcome).toBeNull();
			const next = await f.engine.step(
				f.id,
				f.rt,
				new AbortController().signal,
			);
			expect(next.event).toBe("rejected");
			expect(f.invoked()).toBe(0);
			expect(effects).toBe(effectHappened ? 1 : 0);
			expect(
				(await f.engine.view(f.id))!.attempts
					.at(-1)!
					.rejection!.some((r) => r.rule === "same_failure"),
			).toBe(true);
		} finally {
			f.store.close();
		}
	});

test("an unavailable acceptance check is recorded once, then deterministic alarms still run", async () => {
	const f = await fixture();
	let calls = 0;
	try {
		const rt = {
			...f.rt,
			acceptance: {
				verify: async () => {
					calls++;
					throw new Error("offline");
				},
			},
		};
		await f.engine.step(f.id, rt, new AbortController().signal);
		const v = (await f.engine.view(f.id))!;
		expect(calls).toBe(1);
		expect(v.attempts[0]!.settlement).toMatchObject({
			stage: "done",
			reason: "acceptance_unavailable",
		});
		expect(v.verifications[0]).toMatchObject({ passed: false, criteria: [] });
	} finally {
		f.store.close();
	}
});

test("deadline during a tool records its unknown outcome and consumed attempt", async () => {
	const f = await fixture();
	const abort = new AbortController();
	try {
		const rt = {
			...f.rt,
			tools: {
				...f.rt.tools,
				invoke: async () => {
					f.setNow(1000 + startInput().policy.budget.wallMs + 1);
					abort.abort();
					throw new Error("deadline");
				},
			},
		};
		const r = await f.engine.step(f.id, rt, abort.signal);
		expect(r.status).toBe("stopped");
		const v = (await f.engine.view(f.id))!;
		expect(v.attempts[0]).toMatchObject({
			state: "interrupted",
			outcome: null,
		});
		expect(v.report!.stats.attempts).toBe(1);
	} finally {
		f.store.close();
	}
});
