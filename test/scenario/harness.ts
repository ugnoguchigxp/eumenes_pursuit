/** Scripted generator, tools and workspace for the scenario tests of spec/fixes-2026-10-22.md. */
import {
	createPursuitEngine,
	type LlmPort,
	type LlmPurpose,
	type Policy,
	type PursuitRuntime,
	type ToolDescriptor,
	type ToolOutcome,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { policy, startInput } from "../support.ts";

export type Script = Partial<Record<LlmPurpose, unknown[]>>;

/** Scripted answers per purpose; records every prompt by purpose. */
export function scripted(script: Script) {
	const prompts: { purpose: LlmPurpose; prompt: string; system?: string }[] =
		[];
	const llm: LlmPort = {
		async complete(request) {
			prompts.push({
				purpose: request.purpose,
				prompt: request.prompt,
				system: request.system,
			});
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
	return { llm, prompts };
}

export const plan = {
	strategy: "方針",
	rationale: "r",
	alternatives: ["別案"],
};
export const hypothesis = {
	hypothesis: "仮説",
	rationale: "r",
	tools: ["read"],
	expected: "e",
};
export const proposal = (
	kind: string,
	extra: Record<string, unknown> = {},
) => ({
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
let k = 0;
/** A tool proposal with a fresh input, so fingerprints never repeat. */
export const call = (
	name: string,
	input: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
) =>
	proposal("tool", {
		tool: name,
		inputJson: JSON.stringify({ n: ++k, ...input }),
		expectedStatus: "ok",
		expectedObservation: "値が返る",
		...extra,
	});
export const read: ToolDescriptor = {
	name: "read",
	description: "",
	inputSchema: {},
	sideEffect: "none",
	permission: "data.read",
};
export const write: ToolDescriptor = {
	name: "write",
	description: "",
	inputSchema: {},
	sideEffect: "workspace",
	permission: "answer.write",
};
export function runtime(
	options: {
		ws?: PursuitRuntime["workspace"];
		tools?: ToolDescriptor[];
		invoke?: (tool: string, input: Record<string, unknown>) => ToolOutcome;
		passes?: boolean;
	} = {},
): PursuitRuntime {
	return {
		tools: {
			list: () => options.tools ?? [read, write],
			invoke: async (call) =>
				options.invoke
					? options.invoke(call.tool, call.input as Record<string, unknown>)
					: { status: "ok", output: { v: 1 }, refs: [] },
		},
		workspace: options.ws ?? null,
		acceptance: {
			verify: async () => [
				{
					id: "total",
					passed: !!options.passes,
					evidence: options.passes ? "合格" : "不合格",
				},
			],
		},
	};
}
/** A workspace whose changes since the checkpoint are `files()` at the time of the call. */
export function workspace(
	files: () => string[] = () => ["src/a.py", "docs/b.md"],
) {
	const log = { restores: 0 };
	const ws: NonNullable<PursuitRuntime["workspace"]> = {
		checkpoint: async () => "cp",
		restore: async () => {
			log.restores++;
		},
		digest: async () => `d${log.restores}:${files().join(",")}`,
		changesSince: async () => ({
			filesTouched: files(),
			linesChanged: files().length,
			protectedTouched: [],
		}),
	};
	return { ws, log };
}
export async function run(options: {
	script: Script;
	conditions?: Record<string, unknown>;
	policy?: (p: Policy) => Policy;
	runtime?: PursuitRuntime;
	steps?: number;
	/** Use the scripted LLM as the reviewer too (script.review). */
	reviewer?: boolean;
}) {
	const { llm, prompts } = scripted(options.script);
	const store = openStore(":memory:", migrations);
	let n = 0;
	const engine = createPursuitEngine({
		store,
		clock: { now: () => 1000 + n },
		ids: { next: (p) => `${p}${n++}` },
		generator: llm,
		reviewer: options.reviewer ? llm : null,
		judge: null,
	});
	const base = startInput();
	const { pursuitId } = await engine.start(
		startInput({
			policy: (options.policy ?? ((p) => p))(policy),
			conditions: { ...base.conditions, ...options.conditions },
		}),
		`k${++k}`,
	);
	const rt = options.runtime ?? runtime();
	for (let i = 0; i < (options.steps ?? 60); i++) {
		const r = await engine.step(pursuitId, rt, AbortSignal.timeout(5000));
		if (r.done) break;
	}
	return { view: (await engine.view(pursuitId))!, prompts };
}
