import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
import { sandboxAvailable } from "../../eval/tools/sandbox.ts";
import { auditSubmission } from "./audit.ts";
import { codexBridge, codexModel, emptyCodexUsage } from "./codex-bridge.ts";
import {
	calibrate,
	fixture,
	heldOut,
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

const [mode, selection, output, option, ...extra] = process.argv.slice(2);
const resume = option === "--resume";
const comparison = mode === "compare" || mode === "compare-selection";
if (
	(mode !== "inspect" && mode !== "api" && mode !== "direct" && !comparison) ||
	!selection ||
	!output ||
	(option !== undefined &&
		(!resume || (mode !== "api" && mode !== "compare-selection"))) ||
	extra.length > 0
) {
	throw new Error(
		"usage: bun examples/optimizer/run.ts <inspect|api|direct|compare|compare-selection> <all|sample[,sample]> <output directory> [--resume (api, compare-selection)]",
	);
}
if (!sandboxAvailable())
	throw new Error("Linux with bwrap and prlimit is required");
const names = selectStarters(selection, mode);
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
const environment = `${process.platform}-${process.arch}/bun-${Bun.version}/${Bun.spawnSync(["/usr/bin/python3", "--version"]).stdout.toString().trim()}`;
const summaries = [];
let unlock: (() => void) | undefined;
try {
	unlock = lockCampaign(root);
	const role = settings?.require("llm.generator");
	const contract = {
		version: 2,
		mode,
		names,
		policy,
		environment,
		source: sourceIdentity(fileURLToPath(new URL("../..", import.meta.url)), [
			"examples/optimizer",
		]),
		provider: bridgeDirectory
			? { codexModel, directory: resolve(bridgeDirectory) }
			: role,
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
	if (settings) settings.setBudget(`campaign:${campaign}`, 3);
	for (const [caseIndex, name] of names.entries()) {
		parent.signal.throwIfAborted();
		const directory = join(root, name);
		await mkdir(directory, { recursive: resume });
		const data = await fixture(name);
		const criteria = data.operationCount
			? acceptance.map((item) =>
					item.id === "speed"
						? {
								...item,
								text: `${data.operationCount.toLocaleString("ja-JP")}操作を各実行3秒以内に処理する`,
							}
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
				runCandidate,
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
				? await absoluteTarget(
						runCandidate,
						data.initialSource,
						data.large,
						setup,
					)
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
		const pair =
			mode === "compare-selection"
				? (["manual", "optimizer"] as const)
				: (["direct", "optimizer"] as const);
		const arms = comparison
			? caseIndex % 2 === 0
				? pair
				: [...pair].reverse()
			: [mode === "direct" ? ("direct" as const) : ("optimizer" as const)];
		const unstable = unstableCalibration(
			calibration.initial,
			calibration.noise,
		);
		const commonGoal = [
			data.goal ?? goal,
			"README.md と windowsum.py を読んでから編集する。編集した版は check_candidate の passed を確認してから measure_candidate に渡す。完了前に read_candidate で現行版と最良版を照合する。",
			...(bridgeDirectory
				? [
						"一般的なアルゴリズムや公開資料を確認する際はCodexのWeb検索を使える。検索語に課題のコード、入力、その他の非公開情報を含めない。",
					]
				: []),
		].join("\n");
		for (const arm of arms) {
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
			const task = await openOptimizer({
				...data,
				directory: jobDirectory,
				noise: calibration.noise,
				environment,
				selection: arm === "manual" ? "manual" : "automatic",
			});
			const store = openStore(join(jobDirectory, "ledger.sqlite"), migrations);
			const jobId = `${campaign}/${name}/${arm}`;
			settings?.setBudget(`job:${jobId}`, 0.45);
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
							goal: commonGoal,
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
								commonGoal +
								"\n最初の act は read_file に path=windowsum.py を指定する1件。この課題で actions が2件以上なら必ず sequence=true で順に実行する。" +
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
						join(jobDirectory, "windowsum.py"),
						best.source,
					);
				else if (best.version !== task.candidates.initial)
					await publishCandidate(
						join(jobDirectory, "best-partial.py"),
						best.source,
					);
				const usage = totalUsage(meter?.events(jobId) ?? []);
				const summary = {
					name,
					arm,
					requestedModel: role?.model ?? codexModel,
					...(codex ? { provider: "codex-exec", webSearch: "live" } : {}),
					status,
					verified: report?.verified ?? false,
					attempts,
					...(!codex
						? {
								servedModels: [
									...new Set(usage.events.map((event) => event.servedModel)),
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
