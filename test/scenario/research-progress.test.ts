import { expect, test } from "bun:test";
import { createPursuitEngine, type ToolDescriptor } from "../../src/index.ts";
import { proposalRequest } from "../../src/domains/generation/prompts.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";
import {
	call,
	hypothesis,
	plan,
	proposal,
	read,
	run,
	runtime,
	scripted,
	write,
} from "./harness.ts";

test("prior hypothesis evidence and remaining tool budget survive a step back", async () => {
	const r = await run({
		script: {
			plan: [plan],
			hypothesize: [hypothesis, hypothesis],
			propose: [call("read"), proposal("step_back"), proposal("done")],
		},
		conditions: { verifyOn: "claim" },
		runtime: runtime({
			passes: true,
			invoke: () => ({
				status: "ok",
				output: { text: "retained-evidence", calls_left: 0 },
				refs: [{ kind: "source", uri: "fixture://original" }],
			}),
		}),
	});
	const prompt = r.prompts
		.filter((p) => p.purpose === "propose")
		.at(-1)!.prompt;
	expect(prompt).toContain("retained-evidence");
	expect(prompt).toContain("read: 残り 0 回");
	expect(r.view.status).toBe("completed");
});

test("a refused search does not prevent known-source reads and a supported draft", async () => {
	let saved = "";
	const lookup: ToolDescriptor = { ...read, name: "lookup" };
	const r = await run({
		script: {
			plan: [plan],
			hypothesize: [hypothesis],
			propose: [
				call("lookup"),
				call("read"),
				call("write", { text: "known source fact" }),
				proposal("done"),
			],
		},
		conditions: { verifyOn: "claim" },
		runtime: runtime({
			passes: true,
			tools: [lookup, read, write],
			invoke: (tool, input) => {
				if (tool === "lookup")
					return {
						status: "error",
						errorCode: "search_denied",
						output: { candidates: [] },
						refs: [],
					};
				if (tool === "write") saved = String(input.text);
				return {
					status: "ok",
					output: { fact: "known source fact" },
					refs: [{ kind: "source", uri: "fixture://known" }],
				};
			},
		}),
	});
	expect(r.view.status).toBe("completed");
	expect(saved).toBe("known source fact");
	expect(r.view.attempts[0]!.observation?.errorCode).toBe("search_denied");
	expect(r.view.attempts.filter((a) => a.tool === "lookup")).toHaveLength(1);
	expect(r.view.report?.refs.map((r) => r.uri)).toContain("fixture://known");
});

test("the latest deliverable is shown once, with staleness retained", async () => {
	const reader: ToolDescriptor = {
		...read,
		name: "report_read",
		readsBack: true,
		readsWorkspace: true,
	};
	const rt = runtime({
		tools: [read, write, reader],
		invoke: (tool) => ({
			status: "ok",
			output:
				tool === "report_read"
					? { text: "unique-deliverable-content" }
					: { saved: true },
			refs: [],
		}),
	});
	const r = await run({
		script: {
			plan: [plan],
			hypothesize: [hypothesis],
			propose: [
				call("report_read", {}, { acceptanceCheck: [] }),
				call("write", {}, { acceptanceCheck: [] }),
			],
		},
		conditions: { verifyOn: "claim", completionCheck: "acceptance" },
		runtime: rt,
		steps: 4,
	});
	const prompt = proposalRequest({
		view: r.view,
		tools: rt.tools.list(),
		feedback: null,
	}).prompt;
	expect(prompt.split("unique-deliverable-content")).toHaveLength(2);
	expect(prompt).toContain("そのあと書き換えたので古い");
	expect(prompt).toContain("workspace");
});

test("reservation rejection rolls back atomically and allows acquired evidence to be saved", async () => {
	const store = openStore(":memory:", migrations);
	await store.write((db) => db.exec("CREATE TABLE admission (id TEXT)"));
	let admitted = 0,
		invoked = 0,
		saved = "",
		id = 0;
	const { llm, prompts } = scripted({
		plan: [plan],
		hypothesize: [hypothesis],
		propose: [
			call("read"),
			call("blocked"),
			call("write", { text: "acquired fact" }),
			proposal("give_up"),
		],
	});
	const rt = runtime({
		tools: [read, write, { ...read, name: "blocked" }],
		invoke: (tool, input) => {
			invoked++;
			if (tool === "write") saved = String(input.text);
			return {
				status: "ok",
				output: { text: "acquired fact" },
				refs: [{ kind: "source", uri: "fixture://source" }],
			};
		},
	});
	rt.tools.deferInTransaction = (db, call) => {
		if (call.tool !== "blocked") return null;
		admitted++;
		db.query("INSERT INTO admission VALUES (?)").run("must-rollback");
		throw new Error("host_limit_private_details");
	};
	const engine = createPursuitEngine({
		store,
		clock: { now: () => 1000 },
		ids: { next: (p) => `${p}_${++id}` },
		generator: llm,
		reviewer: null,
		judge: null,
	});
	const input = startInput();
	input.conditions = { ...input.conditions, verifyOn: "claim" };
	const { pursuitId } = await engine.start(input, "reservation-test");
	for (let i = 0; i < 6; i++)
		await engine.step(pursuitId, rt, new AbortController().signal);
	const view = (await engine.view(pursuitId))!;
	expect(view.status).toBe("incomplete");
	expect(view.report?.verified).toBe(false);
	expect(saved).toBe("acquired fact");
	expect(admitted).toBe(1);
	expect(invoked).toBe(2);
	expect(
		await store.readSnapshot((db) => db.query("SELECT * FROM admission").all()),
	).toEqual([]);
	expect(view.attempts.map((a) => a.state)).toEqual([
		"settled",
		"rejected",
		"settled",
	]);
	expect(view.inference.filter((i) => i.purpose === "propose")).toHaveLength(4);
	const feedback = prompts
		.filter((p) => p.purpose === "propose")
		.at(-2)!.prompt;
	expect(feedback).toContain("tool_reservation_failed");
	expect(feedback).not.toContain("host_limit_private_details");
	store.close();
});
