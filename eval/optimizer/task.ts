import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CriterionResult, PursuitRuntime } from "../../src/index.ts";
import { createEnvTools } from "../tasks/e/env.ts";
import {
	createToolPort,
	defineTool,
	fail,
	ok,
	prop,
} from "../tools/tool-port.ts";
import { createDirWorkspace } from "../tools/workspace.ts";
import {
	absoluteTarget,
	candidateFile,
	checkCorrectness,
	measure,
	repeats,
	runCandidate,
	type Runner,
} from "./benchmark.ts";
import { digest, openCandidates } from "./candidates.ts";
import type { Workload } from "./data.ts";

const fixture = join(import.meta.dir, "../tasks/e/env-work/hz10e-window-sums");
export const loadBaseline = () =>
	readFile(join(fixture, candidateFile), "utf8");
export const acceptance = [
	{
		id: "correctness",
		text: "取引ごとの集計が固定した正しさの検査をすべて通る",
		method: "machine",
	},
	{
		id: "speed",
		text: "20万件の入力を各実行3秒以内に処理する",
		method: "machine",
	},
	{
		id: "version",
		text: "提出版が正しさと改善を確認した最良候補と一致する",
		method: "machine",
	},
] as const;
export const grants = [
	"env.read",
	"env.write",
	"optimizer.check",
	"optimizer.measure",
] as const;
export const goal =
	"windowsum.py の取引合計を出力仕様のまま高速化する。README.md の20万件・3秒の要件を満たし、正しさと速度を別々に検証する。計測済みの最良候補を提出する。";

interface Options {
	readonly directory: string;
	readonly correctness: readonly Workload[];
	readonly timing: readonly Workload[];
	readonly large: readonly Workload[];
	readonly noise: Readonly<Record<string, number>>;
	readonly environment: string;
	readonly maxMeasurements?: number;
	readonly initialSource?: string;
	readonly baselineSource?: string;
	readonly specification?: string;
	readonly run?: Runner;
}

function passedTarget(results: Awaited<ReturnType<typeof absoluteTarget>>) {
	return (
		results.length > 0 &&
		results.every(
			({ warmup, samples }) =>
				warmup.status === "ok" &&
				warmup.ms <= 3000 &&
				samples.length === repeats &&
				samples.every((s) => s.status === "ok" && s.ms <= 3000),
		)
	);
}

export async function openOptimizer(options: Options) {
	const { directory, correctness, timing, large, noise } = options;
	if (
		!correctness.length ||
		!timing.length ||
		!large.length ||
		new Set(timing.map((input) => input.id)).size !== timing.length ||
		timing.some(({ id }) => !Number.isFinite(noise[id]) || noise[id]! < 0)
	)
		throw new Error("optimizer_invalid_protocol");
	const run = options.run ?? runCandidate;
	const workDir = join(directory, "work");
	const path = join(workDir, candidateFile);
	const baseline = options.baselineSource ?? (await loadBaseline());
	const initial = options.initialSource ?? baseline;
	const specification =
		options.specification ??
		(await readFile(join(fixture, "README.md"), "utf8"));
	const maxMeasurements = options.maxMeasurements ?? 6;
	if (!Number.isSafeInteger(maxMeasurements) || maxMeasurements < 1)
		throw new Error("optimizer_invalid_budget");
	const protocol = digest(
		JSON.stringify({
			repeats,
			correctness,
			timing,
			large,
			noise,
			maxMeasurements,
			environment: options.environment,
			...(initial === baseline ? {} : { initialVersion: digest(initial) }),
			...(options.specification === undefined
				? {}
				: { specificationVersion: digest(specification) }),
		}),
	);
	await mkdir(workDir, { recursive: true });
	const candidates = openCandidates(
		join(directory, "optimizer.sqlite"),
		baseline,
		protocol,
		maxMeasurements,
	);
	try {
		await writeFile(path, initial, { flag: "wx" }).catch((error) => {
			if (error.code !== "EEXIST") throw error;
		});
		await writeFile(join(workDir, "README.md"), specification, {
			flag: "wx",
		}).catch((error) => {
			if (error.code !== "EEXIST") throw error;
		});
	} catch (error) {
		candidates.close();
		throw error;
	}
	const workspace = createDirWorkspace({
		directory,
		workDir,
		isProtected: (name) => name !== candidateFile,
	});
	const tools = createEnvTools({ workDir })
		.filter((tool) =>
			["list_files", "read_file", "write_file"].includes(tool.descriptor.name),
		)
		.map((tool) =>
			tool.descriptor.name !== "write_file"
				? tool
				: {
						...tool,
						async run(
							input: Parameters<typeof tool.run>[0],
							signal: AbortSignal,
						) {
							if (input.path !== candidateFile)
								return fail(
									"optimizer_protected_path",
									"変更できるのは windowsum.py だけです",
								);
							return tool.run(input, signal);
						},
					},
		);
	tools.push(
		defineTool(
			{
				name: "check_candidate",
				description:
					"現行版の出力を固定した正しさ検査で照合する。速度は判定しない。",
				permission: "optimizer.check",
				readsWorkspace: true,
			},
			async (_, signal) => {
				const source = await readFile(path, "utf8");
				const checks = await checkCorrectness(run, source, correctness, signal);
				const passed = checks.every((item) => item.status === "ok");
				const version = candidates.markChecked(source, passed);
				return ok({ version, passed, checks });
			},
		),
		defineTool(
			{
				name: "measure_candidate",
				description:
					"正しさに合格した現行版を最良版と比較する。改善を確認した版だけを自動保存する。",
				permission: "optimizer.measure",
				readsWorkspace: true,
				properties: {
					retryInterrupted: prop("boolean", "中断された計測の明示的な再試行"),
				},
			},
			async (input, signal) => {
				const source = await readFile(path, "utf8");
				const version = digest(source);
				signal.throwIfAborted();
				if (!candidates.checked(version))
					return fail(
						"optimizer_unchecked_version",
						"現行版を先に check_candidate で検査してください",
					);
				const trial = candidates.begin(
					version,
					input.retryInterrupted === true,
				);
				if (trial.kind === "unchanged")
					return ok({ version, best: version, state: trial.kind });
				if (trial.kind === "cached")
					return ok({
						version,
						best: candidates.best().version,
						state: trial.kind,
						measurement: trial.record.id,
						result: JSON.parse(trial.record.result!),
					});
				if (trial.kind !== "started")
					return fail(
						`optimizer_${trial.kind}`,
						`計測は開始されませんでした (${trial.kind})`,
					);
				try {
					const result = await measure(
						run,
						trial.control.source,
						source,
						timing,
						signal,
					);
					signal.throwIfAborted();
					const promoted = candidates.finish(trial.id, result, noise);
					return ok({
						version,
						control: trial.control.version,
						best: candidates.best().version,
						promoted,
						measurement: trial.id,
						result: JSON.parse(JSON.stringify(result)),
					});
				} catch (error) {
					candidates.interrupt(trial.id);
					throw error;
				}
			},
		),
		defineTool(
			{
				name: "restore_best",
				description: "保存済みの最良版を windowsum.py に復元する。",
				permission: "env.write",
				sideEffect: "workspace",
			},
			async (_, signal) => {
				const best = candidates.best();
				const temporary = `${path}.${crypto.randomUUID()}.tmp`;
				try {
					await writeFile(temporary, best.source, { flag: "wx" });
					signal.throwIfAborted();
					await rename(temporary, path);
				} finally {
					await rm(temporary, { force: true });
				}
				return ok({ version: best.version });
			},
		),
		defineTool(
			{
				name: "read_candidate",
				description:
					"現行の windowsum.py の版を実ファイルから読み戻し、最良版との一致を確認する。",
				permission: "env.read",
				readsWorkspace: true,
				readsBack: true,
			},
			async () => {
				const version = digest(await readFile(path, "utf8"));
				const best = candidates.best().version;
				return ok({ version, best, matches: version === best });
			},
		),
	);
	const runtime: PursuitRuntime = {
		tools: createToolPort(tools),
		workspace,
		acceptance: {
			async verify(signal): Promise<CriterionResult[]> {
				const source = await readFile(path, "utf8");
				const targetVersion = digest(source);
				const matches =
					targetVersion === candidates.best().version &&
					targetVersion !== candidates.initial;
				const checks = await checkCorrectness(run, source, correctness, signal);
				const correct = checks.every(({ status }) => status === "ok");
				const speeds =
					correct && matches
						? await absoluteTarget(run, source, large, signal)
						: [];
				const verified = { targetVersion, usedEvidence: [] } as const;
				return [
					{
						id: "correctness",
						passed: correct,
						evidence: JSON.stringify(checks),
						verification: verified,
					},
					{
						id: "speed",
						passed: passedTarget(speeds),
						evidence: speeds.length
							? JSON.stringify(speeds)
							: "正しさと対象版の一致を確認後に計測する",
						verification: verified,
					},
					{
						id: "version",
						passed: matches,
						evidence: matches
							? "検証済みの最良版と一致"
							: "検証済みの改善版と不一致",
						verification: verified,
					},
				];
			},
		},
	};
	return {
		runtime,
		candidates,
		protocol,
		async audit(
			heldOutCorrectness: readonly Workload[],
			heldOutSpeed: readonly Workload[],
			signal: AbortSignal,
		) {
			const source = await readFile(path, "utf8");
			const version = digest(source);
			const correctness = await checkCorrectness(
				run,
				source,
				heldOutCorrectness,
				signal,
			);
			const correct =
				correctness.length > 0 &&
				correctness.every(({ status }) => status === "ok");
			const matches =
				version === candidates.best().version && version !== candidates.initial;
			const speeds =
				correct && matches
					? await absoluteTarget(run, source, heldOutSpeed, signal)
					: [];
			return {
				version,
				correctness,
				speeds,
				passed: correct && matches && passedTarget(speeds),
			};
		},
		close: candidates.close,
	};
}
