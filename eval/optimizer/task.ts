import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
	candidateFile as defaultCandidateFile,
	candidateTimeoutMs,
	checkCorrectness,
	measure,
	measurementEvidence,
	promotes,
	repeats,
	runCandidate,
	type MeasurementMetric,
	type Runner,
	type Series,
} from "./benchmark.ts";
import { digest, openCandidates } from "./candidates.ts";
import type { Workload } from "./data.ts";

const fixture = join(import.meta.dir, "../tasks/e/env-work/hz10e-window-sums");
export const loadBaseline = () =>
	readFile(join(fixture, defaultCandidateFile), "utf8");
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
	readonly candidateFile?: string;
	readonly run?: Runner;
	readonly metric?: MeasurementMetric;
	readonly selection?: "automatic" | "manual";
	readonly measurementOutput?: "summary";
	readonly measurementScope?: {
		readonly unit: "operations" | "transactions" | "requests";
		readonly relativeInputSize: number;
		readonly acceptanceInputSize: number;
	};
}

function passedTarget(results: Awaited<ReturnType<typeof absoluteTarget>>) {
	return (
		results.length > 0 &&
		results.every(
			({ warmup, samples }) =>
				warmup.status === "ok" &&
				warmup.ms <= candidateTimeoutMs &&
				samples.length === repeats &&
				samples.every((s) => s.status === "ok" && s.ms <= candidateTimeoutMs),
		)
	);
}

export async function openOptimizer(options: Options) {
	const {
		directory,
		correctness,
		timing,
		large,
		noise,
		measurementScope,
		metric,
	} = options;
	const candidateFile = options.candidateFile ?? defaultCandidateFile;
	if (
		options.candidateFile !== undefined &&
		(!options.run ||
			candidateFile !== basename(candidateFile) ||
			!candidateFile ||
			[".", "..", "readme.md"].includes(candidateFile.toLowerCase()))
	)
		throw new Error("optimizer_invalid_candidate_file");
	if (
		!correctness.length ||
		!timing.length ||
		!large.length ||
		new Set(timing.map((input) => input.id)).size !== timing.length ||
		timing.some(({ id }) => !Number.isFinite(noise[id]) || noise[id]! < 0)
	)
		throw new Error("optimizer_invalid_protocol");
	const run = options.run ?? runCandidate;
	const automatic = options.selection !== "manual";
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
	async function verifyPerformance(
		source: string,
		inputs: readonly Workload[],
		signal: AbortSignal,
	) {
		if (metric) {
			const results = await measure(
				run,
				baseline,
				source,
				inputs,
				signal,
				metric,
			);
			const thresholds = Object.fromEntries(inputs.map(({ id }) => [id, 0]));
			return {
				passed: promotes(results, thresholds),
				speeds: [],
				sql: measurementEvidence(results, thresholds),
			};
		}
		const speeds = await absoluteTarget(run, source, inputs, signal);
		return { passed: passedTarget(speeds), speeds };
	}
	const protocol = digest(
		JSON.stringify({
			repeats,
			correctness,
			timing,
			large,
			noise,
			maxMeasurements,
			environment: options.environment,
			...(metric ? { metric } : {}),
			...(options.candidateFile === undefined ? {} : { candidateFile }),
			...(!automatic ? { selection: "manual" } : {}),
			...(options.measurementOutput
				? { measurementOutput: options.measurementOutput }
				: {}),
			...(measurementScope ? { measurementScope } : {}),
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
	const candidateState = (version: string, best: string) =>
		measurementScope
			? {
					baseline: candidates.initial,
					matchesBaseline: version === candidates.initial,
					hasAdoptedImprovement: best !== candidates.initial,
				}
			: {};
	const relativeScope = measurementScope
		? {
				scope: {
					kind: "relative",
					inputSize: measurementScope.relativeInputSize,
					unit: measurementScope.unit,
					distributions: timing.map(({ id }) => id),
				},
			}
		: {};
	const measurementOutput = (result: readonly Series[]) => ({
		evidence: measurementEvidence(result, noise),
		...(options.measurementOutput === "summary"
			? {}
			: { result: JSON.parse(JSON.stringify(result)) }),
	});
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
									`変更できるのは ${candidateFile} だけです`,
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
					"現行版を開発用の正しさ検査で照合し、出力不一致では最初に異なる行を返す。速度は判定しない。",
				permission: "optimizer.check",
				readsWorkspace: true,
			},
			async (_, signal) => {
				const source = await readFile(path, "utf8");
				const checks = await checkCorrectness(
					run,
					source,
					correctness,
					signal,
					true,
				);
				const passed = checks.every((item) => item.status === "ok");
				const version = candidates.markChecked(source, passed);
				return ok({ version, passed, checks });
			},
		),
		defineTool(
			{
				name: "measure_candidate",
				description:
					(automatic
						? "正しさに合格した現行版を最良版と比較する。改善を確認した版だけを自動保存する。"
						: "正しさに合格した現行版を最良版と比較する。eligible=true の測定は adopt_candidate で採用できる。") +
					(metric ? "比較指標はSQLの実行回数。" : "") +
					(measurementScope
						? "この相対計測と大規模入力での受入速度検証は別に行う。"
						: ""),
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
					return ok({
						version,
						best: version,
						state: trial.kind,
						...candidateState(version, version),
						...(measurementScope ? { measured: false } : {}),
					});
				if (trial.kind === "cached") {
					const result = JSON.parse(trial.record.result!) as Series[];
					const best = candidates.best().version;
					return ok({
						version,
						control: trial.record.control,
						best,
						state: trial.kind,
						promoted: trial.record.promoted === 1,
						...(!automatic ? { eligible: promotes(result, noise) } : {}),
						measurement: trial.record.id,
						...candidateState(version, best),
						...relativeScope,
						...measurementOutput(result),
					});
				}
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
						metric,
					);
					signal.throwIfAborted();
					const promoted = candidates.finish(
						trial.id,
						result,
						noise,
						automatic,
					);
					const best = candidates.best().version;
					return ok({
						version,
						control: trial.control.version,
						best,
						promoted,
						...(!automatic ? { eligible: promotes(result, noise) } : {}),
						measurement: trial.id,
						...candidateState(version, best),
						...relativeScope,
						...measurementOutput(result),
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
				description: measurementScope
					? "保存版を復元する。改善版が未採用なら比較基準版に戻る。"
					: `保存済みの最良版を ${candidateFile} に復元する。`,
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
				return ok({
					version: best.version,
					...candidateState(best.version, best.version),
				});
			},
		),
		defineTool(
			{
				name: "read_candidate",
				description: measurementScope
					? "現行版を読み戻し、比較基準版・保存版との一致と改善版の採用有無を確認する。"
					: `現行の ${candidateFile} の版を実ファイルから読み戻し、最良版との一致を確認する。`,
				permission: "env.read",
				readsWorkspace: true,
				readsBack: true,
			},
			async () => {
				const version = digest(await readFile(path, "utf8"));
				const best = candidates.best().version;
				return ok({
					version,
					best,
					matches: version === best,
					...candidateState(version, best),
				});
			},
		),
	);
	if (!automatic)
		tools.push(
			defineTool(
				{
					name: "adopt_candidate",
					description:
						"測定IDを指定して現行の改善版を採用する。対象版と比較版が一致する場合だけ採用する。",
					permission: "optimizer.measure",
					readsWorkspace: true,
					properties: { measurement: prop("integer", "採用する測定ID") },
					required: ["measurement"],
				},
				async (input, signal) => {
					const version = digest(await readFile(path, "utf8"));
					signal.throwIfAborted();
					const id = Number(input.measurement);
					if (
						!Number.isSafeInteger(id) ||
						id < 1 ||
						!candidates.adopt(id, version, noise)
					)
						return fail(
							"optimizer_measurement_not_adoptable",
							"現行版・比較版・測定条件を確認してください",
						);
					return ok({
						version,
						best: version,
						measurement: id,
						promoted: true,
					});
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
				const performance =
					correct && matches
						? await verifyPerformance(source, large, signal)
						: null;
				const speeds = performance?.speeds ?? [];
				const verified = { targetVersion, usedEvidence: [] } as const;
				const speedPassed = performance?.passed ?? false;
				return [
					{
						id: "correctness",
						passed: correct,
						evidence: JSON.stringify(checks),
						verification: verified,
					},
					{
						id: "speed",
						passed: speedPassed,
						evidence: performance?.sql
							? JSON.stringify(performance.sql)
							: measurementScope
								? JSON.stringify({
										kind: "absolute",
										inputSize: measurementScope.acceptanceInputSize,
										unit: measurementScope.unit,
										timeLimitMs: candidateTimeoutMs,
										status: speeds.length
											? speedPassed
												? "passed"
												: "failed"
											: "not_run",
										...(speeds.length
											? { results: speeds }
											: {
													reason: !correct
														? "correctness_failed"
														: "adopted_improvement_required",
												}),
									})
								: speeds.length
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
			const performance =
				correct && matches
					? await verifyPerformance(source, heldOutSpeed, signal)
					: null;
			return {
				version,
				correctness,
				speeds: performance?.speeds ?? [],
				...(performance?.sql ? { sql: performance.sql } : {}),
				passed: correct && matches && (performance?.passed ?? false),
			};
		},
		close: candidates.close,
	};
}
