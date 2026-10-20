import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	Assurance,
	CriterionResult,
	JsonValue,
	ToolPort,
} from "../../src/contracts/index.ts";
import type { EvalTask, TaskInstance } from "../contracts.ts";
import { createToolPort, type ToolDef } from "../tools/tool-port.ts";
import { createDirWorkspace } from "../tools/workspace.ts";

/**
 * Layout under the caller's directory:
 * - work/    agent-visible workspace (the only place file tools may touch)
 * - data/    datasets behind the lookup tools (reachable only through them)
 * - hidden/  expected values and hidden checks
 */
export interface TaskEnv {
	readonly directory: string;
	readonly workDir: string;
	readonly dataDir: string;
	readonly hiddenDir: string;
	data<T>(name: string): Promise<T>;
	hidden<T>(name: string): Promise<T>;
}

export interface TaskBuild {
	readonly tools: readonly ToolDef[];
	verify(signal: AbortSignal): Promise<readonly CriterionResult[]>;
	/** Defaults to "nothing is protected". */
	isProtected?(rel: string): boolean;
}

export type Seed = Record<string, JsonValue | string>;

export interface TaskSpec extends Omit<EvalTask, "create"> {
	/** Initial agent-visible files (path relative to work/). */
	readonly work?: Record<string, string>;
	readonly data?: Seed;
	readonly hidden?: Seed;
	build(env: TaskEnv): TaskBuild;
}

async function writeSeed(dir: string, seed: Seed | undefined): Promise<void> {
	for (const [name, value] of Object.entries(seed ?? {})) {
		const path = join(dir, name);
		await mkdir(dirname(path), { recursive: true });
		const text =
			typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
		await writeFile(path, text);
	}
}

async function readJson<T>(dir: string, name: string): Promise<T> {
	return JSON.parse(await readFile(join(dir, name), "utf8")) as T;
}

export function defineTask(spec: TaskSpec): EvalTask {
	const { work, data, hidden, build, ...meta } = spec;
	return {
		...meta,
		async create(directory): Promise<TaskInstance> {
			const env: TaskEnv = {
				directory,
				workDir: join(directory, "work"),
				dataDir: join(directory, "data"),
				hiddenDir: join(directory, "hidden"),
				data: (name) => readJson(join(directory, "data"), name),
				hidden: (name) => readJson(join(directory, "hidden"), name),
			};
			for (const dir of [env.workDir, env.dataDir, env.hiddenDir]) {
				await mkdir(dir, { recursive: true });
			}
			await writeSeed(env.workDir, work);
			await writeSeed(env.dataDir, data);
			await writeSeed(env.hiddenDir, hidden);
			const built = build(env);
			const tools: ToolPort = createToolPort(built.tools);
			const protectedFn = built.isProtected;
			return {
				tools,
				workspace: createDirWorkspace({
					directory,
					workDir: env.workDir,
					...(protectedFn === undefined ? {} : { isProtected: protectedFn }),
				}),
				acceptance: { verify: (signal) => built.verify(signal) },
				dispose: async () => {},
			};
		},
	};
}

export function criterion(
	id: string,
	passed: boolean,
	evidence: string,
	assurance: Assurance = "exact",
	findings?: CriterionResult["findings"],
): CriterionResult {
	return findings?.length
		? { id, passed, evidence, assurance, findings }
		: { id, passed, evidence, assurance };
}
