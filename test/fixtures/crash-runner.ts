import { appendFileSync } from "node:fs";
import {
	createPursuitEngine,
	type LlmPort,
	type PursuitRuntime,
	type JudgePort,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";
export function fixture(path: string, marker: string, crash: string | null) {
	const store = openStore(path, migrations);
	let seq = 0,
		judgeCalls = 0;
	const generator: LlmPort = {
		async complete(r) {
			const value =
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
								text: null,
								expectedStatus: "ok",
								expectedObservation: "result",
								whatChanged: "",
								message: "",
								missing: "",
							};
			return {
				value: r.schema.parse(value),
				model: "fixture",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const judge: JudgePort = {
		maxQuestions: 16,
		ask: async () => {
			if (++judgeCalls === 2 && crash === "post") process.exit(93);
			return {
				model: "fixture",
				adapter: null,
				answers: {},
				inputTokens: 0,
				latencyMs: 0,
			};
		},
	};
	const engine = createPursuitEngine({
		store,
		generator,
		reviewer: null,
		judge,
		clock: { now: () => Date.now() },
		ids: { next: (p) => `${p}-${crypto.randomUUID()}-${seq++}` },
	});
	const runtime: PursuitRuntime = {
		workspace: null,
		tools: {
			list: () => [
				{
					name: "read",
					description: "fixture",
					inputSchema: {},
					sideEffect: "none",
					permission: "data.read",
				},
			],
			invoke: async () => {
				if (crash === "before") process.exit(91);
				appendFileSync(marker, "effect\n");
				if (crash === "after") process.exit(92);
				return { status: "ok", output: "result", refs: [] };
			},
		},
		acceptance: {
			verify: async () => {
				if (crash === "acceptance") process.exit(94);
				return [
					{ id: "total", passed: false, evidence: "fixture not complete" },
				];
			},
		},
	};
	return { engine, store, runtime };
}
if (import.meta.main) {
	const [path, marker, crash] = process.argv.slice(2);
	const f = fixture(path!, marker!, crash!);
	const input = startInput();
	input.conditions = { ...input.conditions, judge: true };
	const { pursuitId } = await f.engine.start(input, "process-crash");
	console.log(pursuitId);
	for (let i = 0; i < 3; i++)
		await f.engine.step(pursuitId, f.runtime, new AbortController().signal);
	f.store.close();
}
