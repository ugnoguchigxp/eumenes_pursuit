import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createPursuitEngine,
	policySchema,
	terminalStatuses,
	type LlmPort,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { remainingWallMs } from "../../src/domains/rules/checks.ts";
import { deadlineSignal, stepWithDeadline } from "../../standalone/deadline.ts";
import { createRoleLlm } from "../../standalone/llm.ts";
import { openSettings, settingsPath } from "../../standalone/settings.ts";
import { openStore } from "../../standalone/store.ts";
import { totalUsage } from "../../standalone/usage.ts";
import { runDirect } from "../../eval/direct.ts";
import { conditionsFor } from "../../eval/conditions.ts";
import { sourceIdentity } from "../../eval/run-config.ts";
import {
	absoluteTarget,
	candidateFile as defaultCandidateFile,
	checkCorrectness,
	runCandidate,
} from "../../eval/optimizer/benchmark.ts";
import { digest } from "../../eval/optimizer/candidates.ts";
import {
	acceptance,
	goal,
	grants,
	openOptimizer,
} from "../../eval/optimizer/task.ts";
import { isolatedBunAvailable } from "../../eval/tools/code.ts";
import { sandboxAvailable } from "../../eval/tools/sandbox.ts";
import { recoverableResponsesError } from "./api-recovery.ts";
import { auditSubmission } from "./audit.ts";
import { codexBridge, codexModel, emptyCodexUsage } from "./codex-bridge.ts";
import {
	calibrate,
	fixture,
	heldOut,
	isRanking,
	selectStarters,
	unstableCalibration,
} from "./fixtures.ts";
import {
	lockCampaign,
	openCampaign,
	publishCandidate,
	readRecord,
	writeRecord,
} from "./run-state.ts";
import { optimizerWorkflow } from "./workflow.ts";

const [mode, selection, output, option, ...extra] = process.argv.slice(2);
const resume = option === "--resume";
const optimizerFirst = option === "--optimizer-first";
const reverseOrder = option === "--reverse-order";
const stateComparison = mode === "compare-state";
const measurementSummaryComparison = mode === "compare-measurement-summary";
const presentationComparison = stateComparison || measurementSummaryComparison;
const comparison =
	mode === "compare" || mode === "compare-selection" || presentationComparison;
const canResume = mode === "api" || mode === "compare-selection";
const campaignLimitUsd = 3;
const jobLimitUsd = 0.45;
if (
	(mode !== "inspect" && mode !== "api" && mode !== "direct" && !comparison) ||
	!selection ||
	!output ||
	(option !== undefined &&
		!(resume && canResume) &&
		!(optimizerFirst && mode === "compare") &&
		!(reverseOrder && presentationComparison)) ||
	extra.length > 0
) {
	throw new Error(
		"usage: bun examples/optimizer/run.ts <inspect|api|direct|compare|compare-selection|compare-state|compare-measurement-summary> <all|sample[,sample]> <output directory> [--resume (api, compare-selection) | --optimizer-first (compare) | --reverse-order (compare-state, compare-measurement-summary)]",
	);
}
const names = selectStarters(selection, mode);
const usesPython = names.some((name) => !isRanking(name));
if (usesPython && !sandboxAvailable())
	throw new Error("Linux with bwrap and prlimit is required");
if (names.some(isRanking) && !isolatedBunAvailable())
	throw new Error(
		"ISUCON12 ranking requires sandbox-exec or Linux with bwrap and prlimit",
	);
const root = resolve(output);
if (!resume) {
	await mkdir(dirname(root), { recursive: true });
	await mkdir(root);
}
const policy = policySchema.parse(
	JSON.parse(
		await readFile(
			new URL("../../config/policy.v1.json", import.meta.url),
			"utf8",
		),
	),
);
const bridgeDirectory = process.env.OPTIMIZER_CODEX_BRIDGE;
const settings =
	mode === "inspect" || bridgeDirectory
		? null
		: openSettings(process.env.OPTIMIZER_SETTINGS);

const parent = new AbortController();
process.on("SIGINT", () => parent.abort(new Error("interrupted")));
process.on("SIGTERM", () => parent.abort(new Error("interrupted")));
const environment =
	`${process.platform}-${process.arch}/bun-${Bun.version}` +
	(usesPython
		? `/${Bun.spawnSync(["/usr/bin/python3", "--version"]).stdout.toString().trim()}`
		: "");
const summaries = [];
let unlock: (() => void) | undefined;
try {
	unlock = lockCampaign(root);
	const role = settings?.require("llm.generator");
	const contract = {
		version: 2,
		mode,
		names,
		optimizerFirst,
		...(presentationComparison
			? { reverseOrder, campaignLimitUsd, jobLimitUsd }
			: {}),
		policy,
		environment,
		source: sourceIdentity(fileURLToPath(new URL("../..", import.meta.url)), [
			"examples/optimizer",
		]),
		provider: bridgeDirectory
			? { codexModel, directory: resolve(bridgeDirectory) }
			: role,
		...(role?.provider === "openai"
			? {
					endpointIdentity: digest(
						process.env.OPENAI_BASE_URL ?? "sdk-default",
					),
				}
			: {}),
		settings: settings
			? resolve(process.env.OPTIMIZER_SETTINGS ?? settingsPath)
			: null,
	};
	const campaign = await openCampaign(
		root,
		digest(JSON.stringify(contract)),
		resume,
		contract,
	);
	let campaignBudgetConfigured = false;
	for (const [caseIndex, name] of names.entries()) {
		parent.signal.throwIfAborted();
		const directory = join(root, name);
		await mkdir(directory, { recursive: resume });
		const data = await fixture(name);
		const run = data.run ?? runCandidate;
		const candidateFile = data.candidateFile ?? defaultCandidateFile;
		const { operationCount, correctnessText, speedText } = data;
		const operationLabel =
			data.operationUnit === "requests" ? "件の照会" : "操作";
		const speed =
			speedText ??
			(operationCount
				? data.metric
					? "順位を保ったままランキング照会時のSQL実行回数を初期版より減らす"
					: `${operationCount.toLocaleString("ja-JP")}${operationLabel}を各実行3秒以内に処理する`
				: undefined);
		const criteria = speed
			? acceptance.map((item) =>
					item.id === "speed"
						? { ...item, text: speed }
						: item.id === "correctness" && correctnessText
							? { ...item, text: correctnessText }
							: item,
				)
			: acceptance;
		const setup = AbortSignal.any([parent.signal, AbortSignal.timeout(120000)]);
		const initialPath = join(directory, "initial.json");
		const previousInitial = resume
			? await readRecord<{
					version: string;
					controlVersion: string;
					correctness: Awaited<ReturnType<typeof checkCorrectness>>;
					speed: Awaited<ReturnType<typeof absoluteTarget>>;
				}>(initialPath)
			: undefined;
		const version = digest(data.initialSource);
		const controlVersion = digest(data.baselineSource);
		if (
			previousInitial &&
			(previousInitial.version !== version ||
				previousInitial.controlVersion !== controlVersion)
		)
			throw new Error("optimizer_resume_starter_changed");
		const initial =
			previousInitial?.correctness ??
			(await checkCorrectness(
				run,
				data.initialSource,
				data.correctness,
				setup,
			));
		const correct = initial.every((item) => item.status === "ok");
		if (correct !== data.expectedCorrect)
			throw new Error(`starter_verification_changed:${name}`);
		const startingSpeed =
			previousInitial?.speed ??
			(correct
				? await absoluteTarget(run, data.initialSource, data.large, setup)
				: []);
		const initialRecord = {
			version,
			controlVersion,
			correctness: initial,
			speed: startingSpeed,
		};
		if (!previousInitial) await writeRecord(initialPath, initialRecord);
		if (mode === "inspect") {
			const summary = {
				name,
				initialCorrect: correct,
				initialSpeed: startingSpeed[0]?.warmup.status ?? "not_measured",
			};
			summaries.push(summary);
			console.log(JSON.stringify(summary));
			continue;
		}
		const calibrationPath = join(directory, "calibration.json");
		const previousCalibration = resume
			? await readRecord<Awaited<ReturnType<typeof calibrate>>>(calibrationPath)
			: undefined;
		const calibration = previousCalibration ?? (await calibrate(data, setup));
		if (!previousCalibration) await writeRecord(calibrationPath, calibration);
		const pair = stateComparison
			? (["optimizer", "candidate-state"] as const)
			: measurementSummaryComparison
				? (["optimizer", "measurement-summary"] as const)
				: mode === "compare-selection"
					? (["manual", "optimizer"] as const)
					: (["direct", "optimizer"] as const);
		const arms = comparison
			? (caseIndex % 2 === 0) !== (optimizerFirst || reverseOrder)
				? pair
				: [...pair].reverse()
			: [mode === "direct" ? ("direct" as const) : ("optimizer" as const)];
		const unstable = data.metric
			? []
			: unstableCalibration(calibration.initial, calibration.noise);
		const taskGoal = data.goal ?? goal;
		const webGuidance = bridgeDirectory
			? "\n一般的なアルゴリズムや公開資料を確認する際はCodexのWeb検索を使える。検索語に課題のコード、入力、その他の非公開情報を含めない。"
			: "";
		for (const arm of arms) {
			const { timingOperations } = data;
			if (arm === "candidate-state" && (!timingOperations || !operationCount))
				throw new Error(`optimizer_missing_measurement_scope:${name}`);
			const measurementScope =
				arm === "candidate-state" && timingOperations && operationCount
					? {
							unit: data.operationUnit ?? ("operations" as const),
							relativeInputSize: timingOperations,
							acceptanceInputSize: operationCount,
						}
					: undefined;
			const jobDirectory = comparison ? join(directory, arm) : directory;
			const resultPath = join(jobDirectory, "result.json");
			const previous = resume
				? await readRecord<Record<string, unknown>>(resultPath)
				: undefined;
			if (previous && previous.auditStatus !== "interrupted") {
				const summary = { ...previous };
				for (const key of ["audit", "history", "report"]) delete summary[key];
				summaries.push(summary);
				continue;
			}
			if (unstable.length) {
				const summary = {
					name,
					arm,
					requestedModel: role?.model ?? codexModel,
					status: "not_run",
					failure: "optimizer_calibration_unstable",
					auditStatus: "not_run",
					correctCompletion: false,
					calls: 0,
					input: 0,
					cached: 0,
					output: 0,
					calibrationWarnings: unstable,
				};
				await mkdir(jobDirectory, { recursive: true });
				await writeRecord(resultPath, summary);
				summaries.push(summary);
				console.log(JSON.stringify(summary));
				continue;
			}
			if (settings && !campaignBudgetConfigured) {
				if (resume && !Number.isFinite(settings.exposureUsd()))
					throw new Error(
						"optimizer_billing_reconciliation_required; see api-pause records and standalone/cli.ts budget show",
					);
				settings.setBudget(`campaign:${campaign}`, campaignLimitUsd);
				campaignBudgetConfigured = true;
			}
			const task = await openOptimizer({
				...data,
				directory: jobDirectory,
				noise: calibration.noise,
				environment,
				selection: arm === "manual" ? "manual" : "automatic",
				...(arm === "measurement-summary"
					? { measurementOutput: "summary" as const }
					: {}),
				...(measurementScope ? { measurementScope } : {}),
			});
			const store = openStore(join(jobDirectory, "ledger.sqlite"), migrations);
			const jobId = `${campaign}/${name}/${arm}`;
			settings?.setBudget(`job:${jobId}`, jobLimitUsd);
			const scope = {
				runId: campaign,
				configId: "optimizer-examples",
				jobId,
				budgetId: campaign,
				pursuitId: null as string | null,
			};
			const meter = settings?.meter(scope, "optimizer");
			const jobStatePath = join(jobDirectory, "driver.json");
			const priorUsage = resume
				? await readRecord<{
						calls: number;
						codex?: ReturnType<typeof emptyCodexUsage>;
					}>(jobStatePath)
				: undefined;
			const codex = bridgeDirectory
				? codexBridge(bridgeDirectory, priorUsage?.codex)
				: null;
			const provider = codex?.model ?? createRoleLlm(role!, meter!);
			let calls = priorUsage?.calls ?? 0;
			const model: LlmPort = {
				async complete(request, signal) {
					signal.throwIfAborted();
					if (calls >= 17) throw new Error("optimizer_model_budget");
					calls++;
					if (codex) codex.usage.calls = calls - 1;
					await writeRecord(jobStatePath, { calls, codex: codex?.usage });
					try {
						return await provider.complete(request, signal);
					} finally {
						if (codex)
							await writeRecord(jobStatePath, { calls, codex: codex.usage });
					}
				},
			};
			const engine = createPursuitEngine({
				store,
				clock: { now: Date.now },
				ids: { next: () => crypto.randomUUID() },
				generator: model,
				reviewer: model,
				judge: null,
			});
			try {
				let status: string;
				let report: {
					readonly verified: boolean;
					readonly reason: string;
				} | null;
				let attempts: number;
				let failure: string | undefined;
				if (arm === "direct") {
					let directAttempts = 0;
					try {
						const direct = await runDirect({
							goal: `${taskGoal}\nREADME.md と ${candidateFile} を読んでから編集する。編集した版は check_candidate の passed を確認してから measure_candidate に渡す。完了前に read_candidate で現行版と最良版を照合する。${webGuidance}`,
							acceptance: criteria,
							grant: grants,
							tools: task.runtime.tools,
							workspace: task.runtime.workspace,
							acceptancePort: task.runtime.acceptance,
							llm: model,
							budget: { requests: 17, toolCalls: 20, wallMs: 480000 },
							onEntry: (entry) => {
								if (entry.kind === "tool") directAttempts++;
							},
							signal: AbortSignal.any([
								parent.signal,
								AbortSignal.timeout(480000),
							]),
						});
						status = direct.outcome;
						report = direct;
						attempts = direct.toolCalls;
					} catch (error) {
						status = "stopped";
						report = null;
						attempts = directAttempts;
						failure =
							error instanceof Error
								? error.name + ": " + error.message
								: String(error);
					}
				} else {
					const { pursuitId } = await engine.start(
						{
							goal:
								`${taskGoal}\n${optimizerWorkflow(candidateFile)}${webGuidance}` +
								(arm === "candidate-state"
									? "\n保存版は改善版の採用前には比較基準版を指す。matches が true でも matchesBaseline が true なら版の受入条件は未達。measure_candidate は応答の scope に示す入力規模での相対比較。大規模入力の速度要件は別の受入検証で、その検証結果は対象版にのみ適用する。"
									: "") +
								(arm === "manual"
									? "\nmeasure_candidate の eligible が true の改善版を選ぶときは、測定IDを adopt_candidate に渡す。"
									: ""),
							acceptance: criteria,
							grant: grants,
							goalRef: null,
							label: "window-sums",
							policy: {
								...policy,
								budget: {
									...policy.budget,
									attempts: 20,
									attemptsPerHypothesis: 10,
									wallMs: 480000,
								},
							},
							conditions: conditionsFor("productive", {
								adapter: null,
								language: "ja",
								findings: "off",
								strategyChange: "free",
								selfCheck: "off",
								verifyOn: "claim",
								prediction: "falsifiable",
								completionCheck: "acceptance",
							}),
						},
						"optimizer-examples",
					);
					scope.pursuitId = pursuitId;
					const started = (await engine.view(pursuitId))!;
					const deadline = deadlineSignal(
						parent.signal,
						remainingWallMs(started, Date.now()),
					);
					const signal = deadline.signal;
					try {
						for (let n = 0; n < policy.budget.transitions; n++) {
							signal.throwIfAborted();
							let step = await stepWithDeadline(
								engine,
								pursuitId,
								task.runtime,
								signal,
							);
							if (step.pendingDecision) {
								const id = step.pendingDecision.operationId;
								const request = await engine.decisionRequest(pursuitId, id);
								step = await engine.completeDecision(
									pursuitId,
									id,
									await model.complete(request, signal),
									task.runtime,
									signal,
								);
							}
							if (step.done) break;
						}
					} catch (error) {
						const recoverable =
							role?.provider === "openai"
								? recoverableResponsesError(error)
								: null;
						if (recoverable && canResume && !signal.aborted && calls < 17) {
							const view = (await engine.view(pursuitId))!;
							if (
								!terminalStatuses.includes(view.status) &&
								remainingWallMs(view, Date.now()) > 0
							) {
								await writeRecord(
									join(jobDirectory, `api-pause-${calls}.json`),
									{
										pursuitId,
										reason: recoverable,
										calls,
										bestVersion: task.candidates.best().version,
										unknownUsageCallIds:
											meter
												?.events(jobId)
												.filter(
													(event) =>
														event.inputTokens === null &&
														event.status === "error",
												)
												.map((event) => event.callId) ?? [],
										recordedAt: new Date().toISOString(),
									},
								);
								throw new Error(
									`optimizer_api_paused:${recoverable}; resume with --resume`,
								);
							}
						}
						failure =
							error instanceof Error
								? error.name + ": " + error.message
								: String(error);
					} finally {
						deadline.dispose();
					}
					let view = (await engine.view(pursuitId))!;
					if (!terminalStatuses.includes(view.status)) {
						if (parent.signal.aborted) throw parent.signal.reason;
						await engine.cancel(
							pursuitId,
							failure ?? "実行上限に到達",
							task.runtime,
							AbortSignal.timeout(15000),
						);
						view = (await engine.view(pursuitId))!;
					}
					report = view.report;
					status = view.status;
					attempts = view.attempts.length;
				}
				const best = task.candidates.best();
				const auditOutcome =
					status === "completed" && report?.verified
						? await auditSubmission(
								() => heldOut(name),
								task.audit,
								parent.signal,
							)
						: null;
				const audit =
					auditOutcome && "result" in auditOutcome ? auditOutcome.result : null;
				const published = audit?.passed && audit.version === best.version;
				if (published)
					await publishCandidate(
						join(jobDirectory, candidateFile),
						best.source,
					);
				else if (best.version !== task.candidates.initial)
					await publishCandidate(
						join(jobDirectory, `best-partial${extname(candidateFile)}`),
						best.source,
					);
				const usage = totalUsage(meter?.events(jobId) ?? []);
				const trace =
					presentationComparison && scope.pursuitId
						? await store.readSnapshot((db) => {
								const id = scope.pursuitId!;
								const baseline = task.candidates.initial;
								return db
									.query(`
								WITH cutoffs AS (
									SELECT
										min(CASE WHEN tool = 'restore_best'
											AND json_extract(observation_json, '$.output.version') = ?2
											THEN settled_at END) AS restored,
										min(CASE WHEN tool = 'measure_candidate'
											AND json_extract(observation_json, '$.output.measurement') IS NOT NULL
											THEN settled_at END) AS measured
									FROM pursuit_attempt WHERE pursuit_id = ?1 AND state = 'settled'
								)
								SELECT
									CASE WHEN restored IS NOT NULL THEN
										(SELECT count(*) FROM pursuit_inference
										 WHERE pursuit_id = ?1 AND created_at >= restored)
									END AS recordedCallsAfterBaselineRestore,
									CASE WHEN measured IS NOT NULL THEN
										(SELECT coalesce(sum(input_tokens + cache_read_tokens + output_tokens), 0)
										 FROM pursuit_inference WHERE pursuit_id = ?1 AND created_at >= measured)
									END AS recordedTokensAfterFirstMeasurement,
									(SELECT count(*) FROM pursuit_decision d, json_each(d.basis_json, '$.rules') rule
									 WHERE d.pursuit_id = ?1 AND rule.value = 'unchanged_failed_claim')
										AS unchangedFailedClaims
								FROM cutoffs`)
									.get(id, baseline);
							})
						: undefined;
				const summary = {
					name,
					arm,
					requestedModel: role?.model ?? codexModel,
					...(codex ? { provider: "codex-exec", webSearch: "live" } : {}),
					status,
					verified: report?.verified ?? false,
					attempts,
					...(trace ? { trace } : {}),
					...(measurementScope ? { measurementScope } : {}),
					...(!codex
						? {
								servedModels: [
									...new Set(
										usage.events.flatMap((event) =>
											event.servedModel ? [event.servedModel] : [],
										),
									),
								],
							}
						: {}),
					correctCompletion: !!published,
					auditStatus: auditOutcome?.status ?? "not_run",
					...(auditOutcome && "reason" in auditOutcome
						? { auditFailure: auditOutcome.reason }
						: {}),
					bestVersion: best.version,
					failure,
					calls,
					unobservedUsageCalls: Math.max(
						0,
						calls -
							(codex?.usage.measuredCalls ??
								usage.calls - usage.unknownUsageCalls),
					),
					...(codex ? { searches: codex.usage.searches } : {}),
					input: codex?.usage.input ?? usage.inputTokens,
					cached:
						codex?.usage.cached ??
						usage.events.reduce((n, e) => n + (e.cacheReadTokens ?? 0), 0),
					output: codex?.usage.output ?? usage.outputTokens,
				};
				await writeRecord(resultPath, {
					...summary,
					audit,
					history: task.candidates.history(),
					report,
				});
				summaries.push(summary);
				console.log(JSON.stringify(summary));
			} finally {
				store.close();
				task.close();
			}
		}
	}
	await writeRecord(join(root, "summary.json"), {
		mode,
		environment,
		samples: summaries,
	});
	parent.signal.throwIfAborted();
} finally {
	unlock?.();
	settings?.close();
}
