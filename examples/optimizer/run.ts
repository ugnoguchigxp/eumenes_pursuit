import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	createPursuitEngine,
	policySchema,
	terminalStatuses,
	type LlmPort,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { stepWithDeadline } from "../../standalone/deadline.ts";
import { createRoleLlm } from "../../standalone/llm.ts";
import { openSettings } from "../../standalone/settings.ts";
import { openStore } from "../../standalone/store.ts";
import { totalUsage } from "../../standalone/usage.ts";
import { runDirect } from "../../eval/direct.ts";
import { conditionsFor } from "../../eval/conditions.ts";
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
import { codexBridge, codexModel } from "./codex-bridge.ts";
import { calibrate, fixture, heldOut, selectStarters } from "./fixtures.ts";

const [mode, selection, output] = process.argv.slice(2);
if (
	(mode !== "inspect" &&
		mode !== "api" &&
		mode !== "direct" &&
		mode !== "compare") ||
	!selection ||
	!output
) {
	throw new Error(
		"usage: bun examples/optimizer/run.ts <inspect|api|direct|compare> <all|sample[,sample]> <new output directory>",
	);
}
if (!sandboxAvailable())
	throw new Error("Linux with bwrap and prlimit is required");
const names = selectStarters(selection, mode);
const root = resolve(output);
await mkdir(dirname(root), { recursive: true });
await mkdir(root);
const policy = policySchema.parse(
	JSON.parse(
		await readFile(
			new URL("../../config/policy.v1.json", import.meta.url),
			"utf8",
		),
	),
);
const campaign = crypto.randomUUID();
const bridgeDirectory = process.env.OPTIMIZER_CODEX_BRIDGE;
const settings =
	mode === "inspect" || bridgeDirectory
		? null
		: openSettings(process.env.OPTIMIZER_SETTINGS);

const parent = new AbortController();
process.on("SIGINT", () => parent.abort(new Error("interrupted")));
const environment = `${process.platform}-${process.arch}/bun-${Bun.version}/${Bun.spawnSync(["/usr/bin/python3", "--version"]).stdout.toString().trim()}`;
const summaries = [];
try {
	if (settings) settings.setBudget(`campaign:${campaign}`, 3);
	for (const [caseIndex, name] of names.entries()) {
		parent.signal.throwIfAborted();
		const directory = join(root, name);
		await mkdir(directory);
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
		const initial = await checkCorrectness(
			runCandidate,
			data.initialSource,
			data.correctness,
			setup,
		);
		const correct = initial.every((item) => item.status === "ok");
		if (correct !== data.expectedCorrect)
			throw new Error(`starter_verification_changed:${name}`);
		const startingSpeed = correct
			? await absoluteTarget(
					runCandidate,
					data.initialSource,
					data.large,
					setup,
				)
			: [];
		const initialRecord = {
			version: digest(data.initialSource),
			controlVersion: digest(data.baselineSource),
			correctness: initial,
			speed: startingSpeed,
		};
		await writeFile(
			join(directory, "initial.json"),
			JSON.stringify(initialRecord, null, 2) + "\n",
		);
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
		const calibration = await calibrate(data, setup);
		await writeFile(
			join(directory, "calibration.json"),
			JSON.stringify(calibration, null, 2) + "\n",
		);
		const arms =
			mode === "compare"
				? ((caseIndex % 2 === 0
						? ["direct", "optimizer"]
						: ["optimizer", "direct"]) as readonly ("direct" | "optimizer")[])
				: mode === "direct"
					? (["direct"] as const)
					: (["optimizer"] as const);
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
			const jobDirectory =
				mode === "compare" ? join(directory, arm) : directory;
			const task = await openOptimizer({
				...data,
				directory: jobDirectory,
				noise: calibration.noise,
				environment,
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
			const role = settings?.require("llm.generator");
			const codex = bridgeDirectory ? codexBridge(bridgeDirectory) : null;
			const provider = codex?.model ?? createRoleLlm(role!, meter!);
			let calls = 0;
			const model: LlmPort = {
				complete(request, signal) {
					if (calls >= 17) throw new Error("optimizer_model_budget");
					calls++;
					return provider.complete(request, signal);
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
								"\n最初の act は read_file に path=windowsum.py を指定する1件。この課題で actions が2件以上なら必ず sequence=true で順に実行する。",
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
					const signal = AbortSignal.any([
						parent.signal,
						AbortSignal.timeout(480000),
					]);
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
					}
					let view = (await engine.view(pursuitId))!;
					if (!terminalStatuses.includes(view.status)) {
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
				const secret =
					status === "completed" && report?.verified
						? await heldOut(name)
						: null;
				const audit = secret
					? await task.audit(
							secret.correctness,
							secret.speed,
							AbortSignal.any([parent.signal, AbortSignal.timeout(60000)]),
						)
					: null;
				const published = audit?.passed && audit.version === best.version;
				if (published)
					await writeFile(join(jobDirectory, "windowsum.py"), best.source, {
						flag: "wx",
					});
				else if (best.version !== task.candidates.initial)
					await writeFile(join(jobDirectory, "best-partial.py"), best.source, {
						flag: "wx",
					});
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
					bestVersion: best.version,
					failure,
					calls: codex?.usage.calls ?? usage.calls,
					...(codex ? { searches: codex.usage.searches } : {}),
					input: codex?.usage.input ?? usage.inputTokens,
					cached:
						codex?.usage.cached ??
						usage.events.reduce((n, e) => n + (e.cacheReadTokens ?? 0), 0),
					output: codex?.usage.output ?? usage.outputTokens,
				};
				await writeFile(
					join(jobDirectory, "result.json"),
					JSON.stringify(
						{
							...summary,
							audit,
							history: task.candidates.history(),
							report,
						},
						null,
						2,
					) + "\n",
				);
				summaries.push(summary);
				console.log(JSON.stringify(summary));
			} finally {
				store.close();
				task.close();
			}
		}
	}
	await writeFile(
		join(root, "summary.json"),
		JSON.stringify({ mode, environment, samples: summaries }, null, 2) + "\n",
	);
} finally {
	settings?.close();
}
