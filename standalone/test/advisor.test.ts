import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPursuitEngine, type LlmPort } from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { startInput } from "../../test/support.ts";
import { createAdvisor } from "../advisor.ts";
import { openStore } from "../store.ts";

test("a pending upper review survives reopen, saves its result and adopts it once without resending", async () => {
	const directory = mkdtempSync(join(tmpdir(), "advice-recovery-")),
		path = join(directory, "ledger.sqlite");
	let store = openStore(path, migrations),
		calls = 0;
	const llm: LlmPort = {
		async complete(r) {
			calls++;
			return {
				value: r.schema.parse({
					diagnosis: "recorded evidence is limited",
					nextSteps: ["test a second workload"],
				}),
				model: "upper-fixture",
				inputTokens: 2,
				outputTokens: 2,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const generator: LlmPort = {
		async complete(r) {
			const value =
				r.purpose === "plan"
					? { strategy: "investigate", rationale: "fixture", alternatives: [] }
					: r.purpose === "hypothesize"
						? {
								hypothesis: "test",
								rationale: "fixture",
								tools: ["request_advice"],
								expected: "evidence",
							}
						: {
								kind: "tool",
								tool: "request_advice",
								inputJson: JSON.stringify({
									question: "which next experiment?",
									artifact: "observations",
								}),
								text: null,
								whatChanged: "",
								expectedStatus: "ok",
								expectedObservation: "advice",
								message: "",
								missing: "",
							};
			return {
				value: r.schema.parse(value),
				model: "fixture",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const make = () =>
		createPursuitEngine({
			store,
			clock: { now: () => Date.now() },
			ids: { next: (p) => `${p}-${crypto.randomUUID()}` },
			generator,
			reviewer: null,
			judge: null,
		});
	const base = {
		list: () => [],
		invoke: async () => {
			throw new Error("unused");
		},
	};
	try {
		let advisor = await createAdvisor({ store, tools: base, llm }),
			engine = make();
		const invalid = {
			tool: "request_advice",
			input: { question: "", artifact: "" },
		};
		expect(
			await store.write((db) =>
				advisor.tools.deferInTransaction!(db, invalid, {
					pursuitId: "not-created",
					attemptId: "invalid",
				}),
			),
		).toBeNull();
		expect(
			(await advisor.tools.invoke(invalid, new AbortController().signal))
				.status,
		).toBe("error");
		expect(
			(
				await advisor
					.directTools("fixture")
					.invoke(invalid, new AbortController().signal)
			).status,
		).toBe("error");
		expect(calls).toBe(0);
		const input = startInput();
		const id = (
			await engine.start(
				{ ...input, grant: [...input.grant, "pursuit.advice"] },
				"study",
			)
		).pursuitId;
		const runtime = () => ({
			tools: advisor.tools,
			workspace: null,
			acceptance: {
				verify: async () => [
					{ id: "total", passed: false, evidence: "not finished" },
				],
			},
		});
		const signal = new AbortController().signal;
		await engine.step(id, runtime(), signal);
		await engine.step(id, runtime(), signal);
		const pending = (await engine.step(id, runtime(), signal)).pendingTool!;
		expect(calls).toBe(0);
		store.close();
		store = openStore(path, migrations);
		engine = make();
		advisor = await createAdvisor({ store, tools: base, llm });
		expect((await engine.step(id, runtime(), signal)).pendingTool).toEqual(
			pending,
		);
		const result = await advisor.resolve(
			engine,
			id,
			pending.operationId,
			signal,
		);
		expect(calls).toBe(1);
		store.close();
		store = openStore(path, migrations);
		engine = make();
		advisor = await createAdvisor({ store, tools: base, llm });
		expect(
			await advisor.resolve(engine, id, pending.operationId, signal),
		).toEqual(result);
		expect(calls).toBe(1);
		await engine.completeTool(
			id,
			pending.attemptId,
			pending.operationId,
			result,
			runtime(),
			signal,
		);
		const revision = (await engine.view(id))!.revision;
		await engine.completeTool(
			id,
			pending.attemptId,
			pending.operationId,
			result,
			runtime(),
			signal,
		);
		expect((await engine.view(id))!.revision).toBe(revision);
		expect((await engine.view(id))!.attempts[0]!.observation!.output).toEqual(
			result.output,
		);
		await store.write((db) =>
			db
				.query(
					"UPDATE host_pursuit_advice SET state='dispatched',result_json=NULL WHERE operation_id=?",
				)
				.run(pending.operationId),
		);
		await expect(
			advisor.resolve(engine, id, pending.operationId, signal),
		).rejects.toThrow("advice_dispatch_outcome_unknown");
		expect(calls).toBe(1);
	} finally {
		store.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
