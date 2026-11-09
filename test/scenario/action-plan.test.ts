import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPursuitEngine,
	type PursuitRuntime,
	type ToolOutcome,
} from "../../src/index.ts";
import { forgetPursuit, migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";
import { proposalRequest } from "../../src/domains/generation/prompts.ts";
import {
	call,
	hypothesis,
	plan,
	proposal,
	read,
	write,
	scripted,
	runtime,
} from "./harness.ts";

const action = (n: number, tool = "read") => ({
	tool,
	inputJson: JSON.stringify({ n }),
	text: null,
	expectedStatus: "ok" as const,
	expectedObservation: "read result",
	whatChanged: "",
	refutedIf: null,
});
const outcome: ToolOutcome = {
	status: "ok",
	output: { text: "retained result" },
	refs: [{ kind: "source", uri: "fixture://one" }],
};
const signal = () => new AbortController().signal;
async function setup(
	following = [action(2), action(3)],
	hypBudget = 6,
	totalBudget = 40,
	path = ":memory:",
) {
	let store = openStore(path, migrations);
	const { llm, prompts } = scripted({
		plan: [plan],
		hypothesize: [hypothesis],
		propose: [call("read", { n: 1 }, { following }), proposal("done")],
	});
	let ids = 0,
		now = 1000;
	const engine = () =>
		createPursuitEngine({
			store,
			clock: { now: () => now },
			ids: { next: (p) => `${p}_${++ids}` },
			generator: llm,
			reviewer: null,
			judge: null,
		});
	const input = startInput();
	input.policy = {
		...input.policy,
		budget: {
			...input.policy.budget,
			attemptsPerHypothesis: hypBudget,
			attempts: totalBudget,
		},
	};
	input.conditions = { ...input.conditions, verifyOn: "claim" };
	const { pursuitId: id } = await engine().start(input, "planned");
	let invoked: number[] = [];
	const rt = runtime({
		passes: true,
		invoke: (_tool, input) => {
			invoked.push(Number(input.n));
			return outcome;
		},
	});
	await engine().step(id, rt, signal());
	await engine().step(id, rt, signal());
	return {
		get store() {
			return store;
		},
		reopen() {
			store.close();
			store = openStore(path, migrations);
		},
		engine,
		id,
		rt,
		prompts,
		invoked,
		expire: () => {
			now = 1e10;
		},
	};
}

test("three independent reads use one proposal and preserve each receipt", async () => {
	const f = await setup();
	try {
		for (let i = 0; i < 4; i++) await f.engine().step(f.id, f.rt, signal());
		const v = (await f.engine().view(f.id))!;
		expect(v.status).toBe("completed");
		expect(f.invoked).toEqual([1, 2, 3]);
		expect(v.attempts).toHaveLength(3);
		expect(v.attempts[0]!.prediction.following).toEqual([action(2), action(3)]);
		const withoutPlan = {
			...v,
			attempts: v.attempts.map((a) => {
				const { following: _plan, ...prediction } = a.prediction;
				return { ...a, prediction };
			}),
		};
		expect(
			proposalRequest({ view: v, tools: f.rt.tools.list(), feedback: null })
				.prompt,
		).toBe(
			proposalRequest({
				view: withoutPlan,
				tools: f.rt.tools.list(),
				feedback: null,
			}).prompt,
		);
		expect(
			v.attempts.every(
				(a) => a.observation?.output && a.refs[0]?.uri === "fixture://one",
			),
		).toBe(true);
		expect(v.inference.filter((i) => i.purpose === "propose")).toHaveLength(2);
		expect(v.actionPlan).toBeUndefined();
	} finally {
		f.store.close();
	}
});

test("plans reject writes, missing permissions and excess budget before dispatch", async () => {
	for (const [following, tools, rule] of [
		[[action(2, "write")], [read, write], "plan_read_only"],
		[
			[action(2, "private")],
			[read, { ...read, name: "private", permission: "no-grant" }],
			"plan_read_only",
		],
		[[action(2), action(3), action(4)], [read], "plan_budget"],
	] as const) {
		const f = await setup([...following], rule === "plan_budget" ? 3 : 6);
		try {
			const rt: PursuitRuntime = {
				...f.rt,
				tools: { ...f.rt.tools, list: () => tools },
			};
			expect((await f.engine().step(f.id, rt, signal())).event).toBe(
				"rejected",
			);
			expect(f.invoked).toEqual([]);
			expect(
				(await f.engine().view(f.id))!.attempts[0]!.rejection?.some(
					(r) => r.rule === rule,
				),
			).toBe(true);
		} finally {
			f.store.close();
		}
	}
});

test("failure of a later admission discards unsent actions and counts usage once", async () => {
	const f = await setup();
	let admitted = 0;
	f.rt.tools.deferInTransaction = () => {
		if (++admitted === 2) throw new Error("refused");
		return null;
	};
	try {
		await f.engine().step(f.id, f.rt, signal());
		expect((await f.engine().step(f.id, f.rt, signal())).event).toBe(
			"rejected",
		);
		const v = (await f.engine().view(f.id))!;
		expect(v.actionPlan).toBeUndefined();
		expect(f.invoked).toEqual([1]);
		expect(v.attempts.map((a) => a.state)).toEqual(["settled", "rejected"]);
		expect(v.inference.filter((i) => i.purpose === "propose")).toHaveLength(1);
	} finally {
		f.store.close();
	}
});

test("an error result also discards independent actions not yet sent", async () => {
	const f = await setup();
	f.rt.tools.invoke = async () => ({
		status: "error",
		output: { message: "denied" },
		refs: [],
	});
	try {
		await f.engine().step(f.id, f.rt, signal());
		expect((await f.engine().view(f.id))!.actionPlan).toBeUndefined();
		expect((await f.engine().view(f.id))!.attempts).toHaveLength(1);
	} finally {
		f.store.close();
	}
});

test("workspace/tool changes and deadlines invalidate unsent reads", async () => {
	for (const boundary of ["workspace", "deadline", "tools"]) {
		const f = await setup();
		let digest = "original";
		const rt: PursuitRuntime = {
			...f.rt,
			workspace: {
				checkpoint: async () => "cp",
				restore: async () => {},
				digest: async () => digest,
				changesSince: async () => ({
					filesTouched: [],
					linesChanged: 0,
					protectedTouched: [],
				}),
			},
		};
		try {
			await f.engine().step(f.id, rt, signal());
			if (boundary === "workspace") digest = "changed";
			else if (boundary === "deadline") f.expire();
			else
				f.rt.tools.list = () => [{ ...read, sideEffect: "workspace" }, write];
			const r = await f.engine().step(f.id, rt, signal());
			expect(r.event).toBe(
				boundary === "deadline" ? "finished" : "interrupted",
			);
			expect(f.invoked).toEqual([1]);
			expect((await f.engine().view(f.id))!.actionPlan).toBeUndefined();
		} finally {
			f.store.close();
		}
	}
});

test("deferred reads resume without re-proposing and reject late results after cancellation", async () => {
	const f = await setup();
	let reserved = 0;
	f.rt.tools.deferInTransaction = () => ({ operationId: `op_${++reserved}` });
	try {
		const first = (await f.engine().step(f.id, f.rt, signal())).pendingTool!;
		expect((await f.engine().step(f.id, f.rt, signal())).pendingTool).toEqual(
			first,
		);
		expect(reserved).toBe(1);
		await f
			.engine()
			.completeTool(
				f.id,
				first.attemptId,
				first.operationId,
				outcome,
				f.rt,
				signal(),
			);
		await f
			.engine()
			.completeTool(
				f.id,
				first.attemptId,
				first.operationId,
				outcome,
				f.rt,
				signal(),
			);
		const second = (await f.engine().step(f.id, f.rt, signal())).pendingTool!;
		expect(reserved).toBe(2);
		expect(f.prompts.filter((p) => p.purpose === "propose")).toHaveLength(1);
		await f.engine().cancel(f.id, "cancel", f.rt, signal());
		await expect(
			f
				.engine()
				.completeTool(
					f.id,
					second.attemptId,
					second.operationId,
					outcome,
					f.rt,
					signal(),
				),
		).rejects.toThrow("tool_result_not_pending");
		expect((await f.engine().view(f.id))!.actionPlan).toBeUndefined();
		expect(f.invoked).toEqual([]);
		await f.engine().step(f.id, f.rt, signal());
		expect(reserved).toBe(2);
	} finally {
		f.store.close();
	}
});

test("host erasure removes private planned inputs", async () => {
	const f = await setup([action(2, "read")]);
	try {
		await f.engine().step(f.id, f.rt, signal());
		expect((await f.engine().view(f.id))!.actionPlan).toBeDefined();
		await f.store.write((db) => forgetPursuit(db, f.id, 2000));
		expect(
			await f.store.readSnapshot((db) =>
				db
					.query("SELECT action_plan_json FROM pursuit_pursuit WHERE id=?")
					.get(f.id),
			),
		).toEqual({ action_plan_json: null });
	} finally {
		f.store.close();
	}
});

test("a durable plan survives reopening before and after its first receipt", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pursuit-plan-"));
	const f = await setup([action(2)], 6, 40, join(dir, "ledger.sqlite"));
	let reserved = 0;
	f.rt.tools.deferInTransaction = () => ({ operationId: `op_${++reserved}` });
	try {
		const first = (await f.engine().step(f.id, f.rt, signal())).pendingTool!;
		f.reopen();
		expect((await f.engine().step(f.id, f.rt, signal())).pendingTool).toEqual(
			first,
		);
		await f
			.engine()
			.completeTool(
				f.id,
				first.attemptId,
				first.operationId,
				outcome,
				f.rt,
				signal(),
			);
		f.reopen();
		const second = (await f.engine().step(f.id, f.rt, signal())).pendingTool!;
		expect(reserved).toBe(2);
		expect(second.operationId).not.toBe(first.operationId);
		expect(f.prompts.filter((p) => p.purpose === "propose")).toHaveLength(1);
		await f
			.engine()
			.completeTool(
				f.id,
				second.attemptId,
				second.operationId,
				outcome,
				f.rt,
				signal(),
			);
		expect((await f.engine().step(f.id, f.rt, signal())).done).toBe(true);
	} finally {
		f.store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an interrupted synchronous action discards its unsent tail without replay", async () => {
	const f = await setup();
	const controller = new AbortController();
	let invoked = 0;
	f.rt.tools.invoke = async () => {
		invoked++;
		controller.abort();
		throw new Error("unknown outcome");
	};
	try {
		await expect(
			f.engine().step(f.id, f.rt, controller.signal),
		).rejects.toThrow();
		expect((await f.engine().step(f.id, f.rt, signal())).event).toBe(
			"interrupted",
		);
		const v = (await f.engine().view(f.id))!;
		expect(v.actionPlan).toBeUndefined();
		expect(v.attempts[0]!.state).toBe("interrupted");
		expect(invoked).toBe(1);
	} finally {
		f.store.close();
	}
});

test("the pursuit-wide budget bounds the whole plan", async () => {
	const f = await setup([action(2), action(3)], 6, 2);
	try {
		expect((await f.engine().step(f.id, f.rt, signal())).event).toBe(
			"rejected",
		);
		expect(f.invoked).toEqual([]);
		expect((await f.engine().view(f.id))!.actionPlan).toBeUndefined();
	} finally {
		f.store.close();
	}
});
