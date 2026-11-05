import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPursuitEngine,
	type LlmPort,
	type PursuitRuntime,
	type ToolOutcome,
} from "../../src/index.ts";
import { forgetPursuit, listPursuitIds, migrations } from "../../src/sqlite.ts";
import * as ledger from "../../src/domains/ledger/index.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";

const outcome: ToolOutcome = {
	status: "ok",
	output: { value: 7 },
	refs: [{ kind: "source", uri: "https://example.test/source" }],
};
const signal = () => new AbortController().signal;
async function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "pursuit-deferred-"));
	const path = join(dir, "ledger.sqlite");
	let store = openStore(path, migrations),
		now = 1000,
		calls = 0,
		proposals = 0,
		invoked = 0;
	const llm: LlmPort = {
		async complete(request) {
			calls++;
			const value =
				request.purpose === "plan"
					? {
							strategy: "fixture-plan-private-marker",
							rationale: "r",
							alternatives: [],
						}
					: request.purpose === "hypothesize"
						? {
								hypothesis: "h",
								rationale: "r",
								tools: ["lookup"],
								expected: "value",
							}
						: {
								kind: proposals++ === 0 ? "tool" : "done",
								tool: "lookup",
								inputJson: "{}",
								whatChanged: "",
								expectedStatus: "ok",
								expectedObservation: "value",
								text: null,
								message: "fixture",
								missing: "",
							};
			return {
				value: request.schema.parse(value),
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
			clock: { now: () => now },
			ids: { next: (p) => `${p}-${crypto.randomUUID()}` },
			generator: llm,
			reviewer: null,
			judge: null,
		});
	let engine = make();
	await store.write((db) =>
		db.exec(
			"CREATE TABLE host_fixture_queue (attempt TEXT PRIMARY KEY, operation TEXT NOT NULL)",
		),
	);
	const runtime: PursuitRuntime = {
		workspace: null,
		acceptance: {
			verify: async () => [{ id: "total", passed: true, evidence: "fixture" }],
		},
		tools: {
			list: () => [
				{
					name: "lookup",
					description: "read-only source lookup",
					inputSchema: {},
					permission: "data.read",
					sideEffect: "none",
				},
			],
			deferInTransaction(db, _call, context) {
				expect(db.inTransaction).toBe(true);
				const operationId = `op-${context.attemptId}`;
				db.query("INSERT INTO host_fixture_queue VALUES (?,?)").run(
					context.attemptId,
					operationId,
				);
				return { operationId };
			},
			invoke: async () => {
				invoked++;
				return outcome;
			},
		},
	};
	const input = startInput({ goal: "fixture-goal-private-marker" });
	const id = (await engine.start(input, "opaque-start-key")).pursuitId;
	await engine.step(id, runtime, signal());
	await engine.step(id, runtime, signal());
	return {
		runtime,
		input,
		id,
		engine: () => engine,
		store: () => store,
		counts: () => ({ calls, invoked }),
		now: (n: number) => {
			now = n;
		},
		restart() {
			store.close();
			store = openStore(path, migrations);
			engine = make();
		},
		close() {
			store.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

test("deferred work survives a fresh host instance without holding or reinvoking a tool", async () => {
	const f = await fixture();
	try {
		const pending = (await f.engine().step(f.id, f.runtime, signal()))
			.pendingTool!;
		expect(pending.operationId).toStartWith("op-");
		const counts = f.counts();
		f.restart();
		for (let i = 0; i < 3; i++)
			expect(
				(await f.engine().step(f.id, f.runtime, signal())).pendingTool,
			).toEqual(pending);
		expect(f.counts()).toEqual(counts);
		expect((await f.engine().view(f.id))!.attempts[0]!.state).toBe("started");
		await f
			.engine()
			.completeTool(
				f.id,
				pending.attemptId,
				pending.operationId,
				outcome,
				f.runtime,
				signal(),
			);
		expect((await f.engine().view(f.id))!.attempts[0]!.state).toBe("settled");
		const done = await f.engine().step(f.id, f.runtime, signal());
		expect(done.status).toBe("completed");
		const replay = await f
			.engine()
			.completeTool(
				f.id,
				pending.attemptId,
				pending.operationId,
				outcome,
				f.runtime,
				signal(),
			);
		expect(replay.revision).toBe(done.revision);
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					pending.attemptId,
					pending.operationId,
					{ ...outcome, output: { value: 8 } },
					f.runtime,
					signal(),
				),
		).rejects.toThrow("tool_result_conflict");
		expect(f.counts().invoked).toBe(0);
	} finally {
		f.close();
	}
});

test("a failed external reservation rolls back the host queue and the core attempt together", async () => {
	const f = await fixture();
	try {
		f.runtime.tools.deferInTransaction = (db, call, context) => {
			db.query("INSERT INTO host_fixture_queue VALUES (?,?)").run(
				context.attemptId,
				"uncommitted",
			);
			throw new Error("fixture_reservation_failed");
		};
		await expect(f.engine().step(f.id, f.runtime, signal())).rejects.toThrow(
			"fixture_reservation_failed",
		);
		expect((await f.engine().view(f.id))!.attempts).toHaveLength(0);
		await f
			.store()
			.readSnapshot((db) =>
				expect(db.query("SELECT * FROM host_fixture_queue").all()).toHaveLength(
					0,
				),
			);
	} finally {
		f.close();
	}
});

test("wrong receipts and results after cancellation cannot be adopted", async () => {
	const f = await fixture();
	try {
		const p = (await f.engine().step(f.id, f.runtime, signal())).pendingTool!;
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					p.attemptId,
					"wrong-operation",
					outcome,
					f.runtime,
					signal(),
				),
		).rejects.toThrow("tool_operation_mismatch");
		await f.engine().cancel(f.id, "cancelled", f.runtime, signal());
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					p.attemptId,
					p.operationId,
					outcome,
					f.runtime,
					signal(),
				),
		).rejects.toThrow("tool_result_not_pending");
		expect((await f.engine().view(f.id))!.attempts[0]!.observation).toBeNull();
	} finally {
		f.close();
	}
});

test("waiting checks the wall deadline and never records an expired receipt", async () => {
	const f = await fixture();
	try {
		const p = (await f.engine().step(f.id, f.runtime, signal())).pendingTool!;
		f.now(1000 + f.input.policy.budget.wallMs + 1);
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					p.attemptId,
					p.operationId,
					outcome,
					f.runtime,
					signal(),
				),
		).rejects.toThrow();
		expect((await f.engine().step(f.id, f.runtime, signal())).status).toBe(
			"stopped",
		);
		expect((await f.engine().view(f.id))!.attempts[0]!.observation).toBeNull();
	} finally {
		f.close();
	}
});

test("host erasure removes private bodies, blocks delayed writes and tombstones operation replay", async () => {
	const f = await fixture();
	try {
		const p = (await f.engine().step(f.id, f.runtime, signal())).pendingTool!;
		await expect(
			f
				.store()
				.write((db) =>
					db
						.query("DELETE FROM pursuit_acceptance WHERE pursuit_id=?")
						.run(f.id),
				),
		).rejects.toThrow("pursuit_acceptance_frozen");
		expect(await f.store().write((db) => forgetPursuit(db, f.id, 2000))).toBe(
			true,
		);
		expect(await f.store().write((db) => forgetPursuit(db, f.id, 3000))).toBe(
			false,
		);
		expect(await f.engine().view(f.id)).toBeNull();
		expect(
			await f.store().readSnapshot((db) => listPursuitIds(db)),
		).not.toContain(f.id);
		await expect(f.engine().start(f.input, "opaque-start-key")).rejects.toThrow(
			"operation_forgotten",
		);
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					p.attemptId,
					p.operationId,
					outcome,
					f.runtime,
					signal(),
				),
		).rejects.toThrow("pursuit_not_found");
		await expect(
			f
				.store()
				.write((db) =>
					ledger.insertInference(db, {
						id: "late",
						pursuitId: f.id,
						now: 3000,
						row: {
							purpose: "plan",
							model: "fixture",
							inputTokens: 1,
							outputTokens: 1,
							cacheReadTokens: 0,
							latencyMs: 0,
						},
					}),
				),
		).rejects.toThrow("pursuit_forgotten");
		await f.store().readSnapshot((db) => {
			for (const table of [
				"pursuit_pursuit",
				"pursuit_operation",
				"pursuit_strategy",
				"pursuit_acceptance",
				"pursuit_attempt",
			])
				expect(
					JSON.stringify(db.query(`SELECT * FROM ${table}`).all()),
				).not.toContain("private-marker");
		});
	} finally {
		f.close();
	}
});
