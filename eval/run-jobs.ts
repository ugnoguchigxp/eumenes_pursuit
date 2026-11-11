import { verificationEvidence } from "./efficiency.ts";
import { remainingWallMs } from "../src/domains/rules/checks.ts";
import { deadlineSignal } from "../standalone/deadline.ts";
import { createAdvisor } from "../standalone/advisor.ts";
import { findPursuitByOperation } from "../src/sqlite.ts";
import {
	readCheckpoint,
	writeCheckpoint,
	type JobCheckpoint,
} from "./job-checkpoint.ts";
import type { ModeSelection } from "./adaptive.ts";
import {
	totalUsage,
	type UsageScope,
	type UsageTotals,
} from "../standalone/usage.ts";
import { jobKey, recordKey } from "./run-config.ts";
import {
	cancelWithDeadline,
	stepWithDeadline,
} from "../standalone/deadline.ts";
import type { DecisionLease } from "../standalone/larm/connection.ts";
import type { Settings } from "../standalone/settings.ts";
import type { StandaloneStore } from "../standalone/store.ts";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	terminalStatuses,
	type LlmPort,
	type Policy,
	type PursuitEngine,
	type StepResult,
} from "../src/index.ts";
import { conditionsFor, type ConditionName } from "./conditions.ts";
import type { EvalTask, ToolTier } from "./contracts.ts";
import { endNoticeText, runDirect, type DirectEntry } from "./direct.ts";
import {
	isCorrect,
	measure,
	measureDirect,
	withDiagnostics,
	withOutcomeFacts,
	type RunRecord,
} from "./metrics.ts";
import { redactAcceptance, redactError, redactTools } from "./redact.ts";
import {
	claimLimitReached,
	claimLimitReason,
	failedClaims,
	oracleAcceptance,
	oracleGoal,
	type ClaimOracle,
} from "./claim-oracle.ts";

export interface EvalJob {
	readonly task: EvalTask;
	readonly condition: ConditionName;
	readonly repeat: number;
}

/** One already-opened evaluation. This module does not parse arguments or open the host. */
export interface JobSession {
	readonly resume?: boolean;
	readonly pauseOnAdvice?: boolean;
	readonly pauseAfterTools?: number | null;
	readonly selectFor?:
		| ((
				scope: UsageScope,
				goal: string,
				tools: import("../src/index.ts").ToolDescriptor[],
				signal: AbortSignal,
		  ) => Promise<ModeSelection>)
		| undefined;
	readonly advisorFor?: ((scope: UsageScope) => LlmPort) | undefined;
	readonly jobs: readonly EvalJob[];
	readonly concurrency: number;
	readonly root: string;
	readonly runsPath: string;
	readonly claimFeedback: "off" | "verdict";
	readonly useFile: boolean;
	readonly values: {
		readonly name?: string;
		readonly "llm-dir"?: string;
		readonly "keep-work"?: boolean;
		readonly "budget-id"?: string;
		readonly critic?: boolean;
	};
	readonly variantOf: (condition: ConditionName) => string;
	readonly effectiveConfigs: ReadonlyMap<
		ConditionName,
		{ readonly id: string }
	>;
	readonly toolTier: ToolTier;
	readonly claimOracle: ClaimOracle;
	readonly graderFor: (scope: UsageScope) => LlmPort | null;
	readonly reviewerFor: (scope: UsageScope, role?: string) => LlmPort;
	readonly rubricDir: string | null;
	readonly secretDir: string | null;
	readonly corpus: { readonly url: string; readonly log: string } | null;
	readonly meter: ReturnType<Settings["meter"]>;
	readonly secrets: readonly string[];
	readonly policy: Policy;
	readonly maxSteps: number;
	readonly directFull: number;
	readonly generatorFor: (scope: UsageScope) => LlmPort;
	readonly errorText: (error: unknown) => string;
	readonly engineFor: (scope: UsageScope) => PursuitEngine;
	readonly conditionFlags: Parameters<typeof conditionsFor>[1];
	readonly experience: string[];
	readonly budgetTag: string;
	readonly readRecords: () => RunRecord[];
	readonly lease: DecisionLease | null;
	readonly store: StandaloneStore;
	readonly settings: Settings;
	readonly writeSummary: () => void;
}

/**
 * Run the planned jobs, then release the lease, close the store and settings, and write the
 * summary. Every cleanup step is attempted, in that order, even when an earlier one fails.
 */
export async function executeJobs(session: JobSession): Promise<void> {
	const {
		jobs,
		concurrency,
		root,
		runsPath,
		claimFeedback,
		useFile,
		values,
		variantOf,
		effectiveConfigs,
		toolTier,
		claimOracle,
		graderFor,
		reviewerFor,
		rubricDir,
		secretDir,
		corpus,
		meter,
		secrets,
		policy,
		maxSteps,
		directFull,
		generatorFor,
		errorText,
		engineFor,
		conditionFlags,
		experience,
		budgetTag,
		readRecords,
		lease,
		store,
		settings,
		writeSummary,
	} = session;

	/** --claim-feedback verdict with --llm file: end-of-task notices for the generator's responder (show.sh prints them). */
	let noticeSeq = 0;
	function notifyEnd(
		goal: string,
		lastClaim: Parameters<typeof endNoticeText>[1],
		ending: Parameters<typeof endNoticeText>[2] = null,
	) {
		if (claimFeedback !== "verdict" || !useFile) return;
		const dir = resolve(values["llm-dir"]!, "notices");
		mkdirSync(dir, { recursive: true });
		// Written whole, then renamed, so show.sh never prints a half-written notice (§5).
		const name = `${process.pid}-${String(++noticeSeq).padStart(4, "0")}.txt`;
		writeFileSync(
			resolve(dir, `.${name}.tmp`),
			`${endNoticeText(goal, lastClaim, ending)}\n`,
		);
		renameSync(resolve(dir, `.${name}.tmp`), resolve(dir, name));
	}

	/** A give_up or a host stop, for the end notice (spec/fixes-2026-10-22-d.md §3.6). */
	function directEnding(
		result: Awaited<ReturnType<typeof runDirect>> | null,
	): Parameters<typeof endNoticeText>[2] {
		if (!result) return null;
		const last = result.entries.at(-1);
		if (last?.kind === "give_up")
			return { kind: "give_up", reason: last.message ?? result.reason };
		return result.outcome === "stopped"
			? { kind: "stop", reason: result.reason }
			: null;
	}

	function pursuitEnding(view: {
		decisions: readonly { kind: string; reason: string }[];
	}): Parameters<typeof endNoticeText>[2] {
		const last = view.decisions.at(-1);
		if (last?.kind === "give_up")
			return { kind: "give_up", reason: last.reason };
		if (last?.kind === "stop") return { kind: "stop", reason: last.reason };
		return null;
	}

	/** D0 transcripts (the direct baseline has no ledger): results/<run>/direct/<label>.jsonl. */
	const directDir = resolve(root, "direct");

	async function runOne(job: EvalJob) {
		const { task, condition, repeat } = job;
		const variant = variantOf(condition);
		const configId = effectiveConfigs.get(condition)!.id;
		const checkpointPath = join(
			root,
			"checkpoints",
			new Bun.CryptoHasher("sha256")
				.update(JSON.stringify([task.id, condition, repeat]))
				.digest("hex") + ".json",
		);
		const checkpointKey = jobKey(task.id, condition, configId, repeat);
		const saved = session.resume
			? readCheckpoint(checkpointPath, checkpointKey, configId)
			: null;
		if (!session.resume && existsSync(checkpointPath))
			throw new Error("checkpoint_exists_use_resume");
		if (saved && !task.resumable)
			throw new Error("task_does_not_support_resume");
		const scope: UsageScope = saved?.scope ?? {
			runId: values.name!,
			configId,
			jobId: crypto.randomUUID(),
			pursuitId: null,
			...(values["budget-id"] ? { budgetId: values["budget-id"] } : {}),
		};
		const label = `${task.id}/${condition}/${variant}/#${repeat}`;
		const started = saved?.started ?? Date.now();
		const goal = oracleGoal(task.goalFor?.(toolTier) ?? task.goal, claimOracle);
		// Outside the project, so task code cannot reach .env by a relative path.
		const directory =
			saved?.directory ??
			mkdtempSync(
				join(tmpdir(), `eumenes-pursuit-${task.id}-${condition}-${repeat}-`),
			);
		console.log(`[start] ${label} workspace ${directory}`);
		const instance = await task.create(directory, {
			grader: graderFor(scope),
			...(saved ? { resume: true } : {}),
			toolTier,
			critic: values.critic ? reviewerFor(scope, "critic") : null,
			rubricDir,
			secretDir,
			corpus,
		});
		const controller = new AbortController();
		const advisor = session.advisorFor
			? await createAdvisor({
					store,
					tools: instance.tools,
					llm: session.advisorFor(scope),
				})
			: null;
		let tools = redactTools(advisor?.tools ?? instance.tools, secrets);
		const checkpoint: JobCheckpoint = saved ?? {
			format: 1,
			key: checkpointKey,
			configId,
			pursuitId: "",
			stepsStarted: 0,
			directory,
			started,
			scope,
			selection: null,
			selectedCondition: condition,
			paused: false,
			pauseStartedAt: null,
			pausedMs: 0,
			restarts: 0,
			status: "active",
		};
		if (saved) {
			checkpoint.restarts++;
			if (checkpoint.pauseStartedAt !== null) {
				checkpoint.pausedMs += Date.now() - checkpoint.pauseStartedAt;
				checkpoint.pauseStartedAt = null;
			}
		}
		if (task.resumable) writeCheckpoint(checkpointPath, checkpoint);
		if (condition === "AUTO" && !checkpoint.selection) {
			if (!session.selectFor) throw new Error("AUTO_requires_selector");
			const deadline = deadlineSignal(
				controller.signal,
				policy.budget.wallMs - (Date.now() - started),
			);
			try {
				checkpoint.selection = await session.selectFor(
					scope,
					goal,
					[...tools.list()],
					deadline.signal,
				);
			} finally {
				deadline.dispose();
			}
			checkpoint.selectedCondition = checkpoint.selection.condition;
			writeCheckpoint(checkpointPath, checkpoint);
		}
		const selectedCondition = checkpoint.selectedCondition;
		if (
			condition === "AUTO" &&
			Math.min(maxSteps, policy.budget.transitions) <= 1
		)
			throw new Error("selection_exhausted_request_budget");
		const elapsed = Date.now() - started;
		const executionPolicy = {
			...policy,
			budget: {
				...policy.budget,
				wallMs: Math.max(1, policy.budget.wallMs - elapsed),
				transitions: Math.max(
					1,
					policy.budget.transitions - (condition === "AUTO" ? 1 : 0),
				),
			},
		};

		const common = {
			run: values.name!,
			task: task.id,
			group: task.group,
			condition,
			generator: variant,
			level: task.level ?? null,
			repeat,
			expected: task.expected,
			budgetTag,
			...(task.needsCorpus && corpus ? { corpus } : {}),
		};
		const finishRecord = async (
			measurement: (usage: UsageTotals) => ReturnType<typeof measure>,
			error: string | null,
		) => {
			const facts = instance.outcomeFacts
				? await instance.outcomeFacts().catch(() => null)
				: null;
			const usage = totalUsage(meter.events(scope.jobId));
			const folded = withDiagnostics(
				withOutcomeFacts(measurement(usage), facts),
				instance.diagnostics?.() ?? null,
			);
			const record: RunRecord = {
				verificationEvidence: verificationEvidence({
					hostPassed: folded.verified,
					assurance: folded.assurance ?? null,
				}),
				...folded,
				...common,
				configId,
				jobKey: jobKey(task.id, condition, configId, repeat),
				correct: isCorrect(task.expected, { ...folded, error }),
				durationMs: Date.now() - started,
				activeDurationMs: Date.now() - started - checkpoint.pausedMs,
				restarts: checkpoint.restarts,
				error,
				...(condition === "AUTO"
					? { selectedCondition, selection: checkpoint.selection! }
					: {}),
			};
			appendFileSync(runsPath, `${JSON.stringify(record)}\n`);
			checkpoint.status = "finished";
			if (task.resumable) writeCheckpoint(checkpointPath, checkpoint);
			if (!values["keep-work"]) await instance.dispose();
			console.log(
				`[done] ${label}: ${record.outcome}${record.verified ? " (verified)" : ""}${record.verificationIssue ? ` (final verification ${record.verificationIssue}: not judged)` : ""} correct=${record.correct} tools=${record.toolCalls} requests=${record.responderRequests} stepBacks=${record.stepBacks} $${record.usd === null ? "unknown" : record.usd.toFixed(4)} ${Math.round(record.durationMs / 1000)}s`,
			);
		};
		if (selectedCondition === "D0") {
			tools = redactTools(
				advisor?.directTools(goal) ?? instance.tools,
				secrets,
			);
			if (saved) throw new Error("direct_resume_not_supported");
			const id = `direct_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
			mkdirSync(directDir, { recursive: true });
			const transcript = resolve(
				directDir,
				`${task.id}-r${repeat}-${id}.jsonl`,
			);
			let error: string | null = null;
			let result: Awaited<ReturnType<typeof runDirect>> | null = null;
			try {
				result = await runDirect({
					goal,
					acceptance: task.acceptance,
					grant: [...task.grant, ...(advisor ? ["pursuit.advice"] : [])],
					tools,
					workspace: instance.workspace,
					acceptancePort: oracleAcceptance(
						redactAcceptance(instance.acceptance, secrets),
						claimOracle,
					),
					claimLimit: claimOracle.limit,
					llm: generatorFor(scope),
					budget: {
						toolCalls: policy.budget.attempts,
						wallMs: executionPolicy.budget.wallMs,
						requests: Math.min(
							executionPolicy.budget.transitions,
							maxSteps - (condition === "AUTO" ? 1 : 0),
						),
					},
					fullEntries: directFull,
					observation: policy.observation,
					signal: controller.signal,
					onEntry: (entry: DirectEntry) =>
						appendFileSync(transcript, `${JSON.stringify(entry)}\n`),
				});
			} catch (e) {
				error = errorText(e);
				console.error(`[error] ${label}`, error);
			}
			if (!result) {
				if (!values["keep-work"]) await instance.dispose();
				return;
			}
			const last = [...result.entries]
				.reverse()
				.find((e) => e.kind === "claim");
			notifyEnd(
				goal,
				last
					? {
							passed: last.passed === true,
							criteria: result.claimCriteria.at(-1) ?? [],
						}
					: null,
				directEnding(result),
			);
			await finishRecord((usage) => measureDirect(result, id, usage), error);
			return;
		}
		const engine = engineFor(scope);
		let pursuitId = checkpoint.pursuitId;
		let error: string | null = null;
		try {
			const operationKey = `eval-start:${scope.jobId}`;
			if (saved && !pursuitId)
				pursuitId =
					(await store.readSnapshot((db) =>
						findPursuitByOperation(db, operationKey),
					)) ?? "";
			pursuitId ||= (
				await engine.start(
					{
						goal,
						acceptance: task.acceptance,
						grant: [...task.grant, ...(advisor ? ["pursuit.advice"] : [])],
						policy: executionPolicy,
						conditions: conditionsFor(
							selectedCondition as Exclude<ConditionName, "D0">,
							conditionFlags,
						),
						goalRef: null,
						label: task.id,
						...(experience.length ? { experience } : {}),
					},
					operationKey,
				)
			).pursuitId;
			scope.pursuitId = pursuitId;
			checkpoint.pursuitId = pursuitId;
			// Legacy checkpoints did not distinguish the runner counter from the ledger revision.
			checkpoint.stepsStarted ??= (await engine.view(pursuitId))!.revision - 1;
			if (task.resumable) writeCheckpoint(checkpointPath, checkpoint);
			const runtime = {
				tools,
				workspace: instance.workspace,
				acceptance: oracleAcceptance(
					redactAcceptance(instance.acceptance, secrets),
					claimOracle,
				),
			};
			// The existing limit charges the start and, for AUTO, the selection as well.
			const stepLimit = maxSteps - 1 - (condition === "AUTO" ? 1 : 0);
			while (checkpoint.pausedStep || checkpoint.stepsStarted < stepLimit) {
				const pausedStep = checkpoint.pausedStep;
				let step: Pick<
					StepResult,
					"done" | "status" | "pendingTool" | "pendingDecision"
				>;
				if (pausedStep) {
					const view = (await engine.view(pursuitId))!;
					const { pendingTool, pendingDecision } = pausedStep;
					step = {
						done: terminalStatuses.includes(view.status),
						status: view.status,
						...(pendingTool &&
						view.attempts.some(
							(a) =>
								a.id === pendingTool.attemptId &&
								a.state === "started" &&
								a.pendingOperationId === pendingTool.operationId,
						)
							? { pendingTool }
							: {}),
						...(pendingDecision &&
						view.productive?.request?.id === pendingDecision.operationId
							? { pendingDecision }
							: {}),
					};
				} else {
					checkpoint.stepsStarted++;
					if (task.resumable) writeCheckpoint(checkpointPath, checkpoint);
					step = await stepWithDeadline(
						engine,
						pursuitId,
						runtime,
						controller.signal,
					);
				}
				if (step.done) break;
				const current = (await engine.view(pursuitId))!;
				const executed = current.attempts.filter(
					(a) => a.state === "settled",
				).length;
				if (
					!checkpoint.paused &&
					((session.pauseOnAdvice && step.pendingTool) ||
						(session.pauseAfterTools && executed >= session.pauseAfterTools))
				) {
					if (!task.resumable) throw new Error("task_does_not_support_pause");
					checkpoint.paused = true;
					checkpoint.pauseStartedAt = Date.now();
					if (
						step.pendingTool ||
						step.pendingDecision ||
						step.status === "awaiting_consultation"
					)
						checkpoint.pausedStep = {
							pendingTool: step.pendingTool,
							pendingDecision: step.pendingDecision,
						};
					writeCheckpoint(checkpointPath, checkpoint);
					console.log(
						`[paused] ${label} pursuit=${pursuitId} revision=${current.revision} pending=${step.pendingTool?.operationId ?? "none"}`,
					);
					return "paused" as const;
				}
				if (step.pendingDecision) {
					const { operationId } = step.pendingDecision;
					const request = await engine.decisionRequest(pursuitId, operationId);
					const deadline = deadlineSignal(
						controller.signal,
						remainingWallMs(current, Date.now()),
					);
					try {
						deadline.signal.throwIfAborted();
						const response = await reviewerFor(scope).complete(
							request,
							deadline.signal,
						);
						step = await engine.completeDecision(
							pursuitId,
							operationId,
							response,
							runtime,
							deadline.signal,
						);
					} catch (error) {
						if (!deadline.signal.aborted) throw error;
						step = await stepWithDeadline(
							engine,
							pursuitId,
							runtime,
							controller.signal,
						);
					} finally {
						deadline.dispose();
					}
					if (step.done) break;
				}
				if (step.pendingTool) {
					if (!advisor)
						throw new Error("pending_external_work_requires_host_worker");
					const deadline = deadlineSignal(
						controller.signal,
						remainingWallMs(current, Date.now()),
					);
					try {
						const outcome = await advisor.resolve(
							engine,
							pursuitId,
							step.pendingTool.operationId,
							deadline.signal,
						);
						await engine.completeTool(
							pursuitId,
							step.pendingTool.attemptId,
							step.pendingTool.operationId,
							outcome,
							runtime,
							deadline.signal,
						);
					} finally {
						deadline.dispose();
					}
				}

				if (claimOracle.limit !== null) {
					const failed = failedClaims((await engine.view(pursuitId))!);
					if (claimLimitReached(failed, claimOracle)) {
						await cancelWithDeadline(
							engine,
							pursuitId,
							claimLimitReason,
							runtime,
							controller.signal,
						);
						break;
					}
				}
				if (step.status === "awaiting_consultation") {
					const view = (await engine.view(pursuitId))!;
					const open = view.consultations.find((c) => c.answer === null)!;
					if (view.consultations.length > 3) {
						await cancelWithDeadline(
							engine,
							pursuitId,
							"相談が3回を超えました",
							runtime,
							controller.signal,
						);
						break;
					}
					await engine.answer(pursuitId, open.id, task.consultAnswer);
				}
				if (pausedStep) {
					delete checkpoint.pausedStep;
					writeCheckpoint(checkpointPath, checkpoint);
				}
			}
			const view = (await engine.view(pursuitId))!;
			if (!terminalStatuses.includes(view.status))
				await cancelWithDeadline(
					engine,
					pursuitId,
					"評価の手順数の上限",
					runtime,
					controller.signal,
				);
		} catch (e) {
			error = errorText(e);
			console.error(`[error] ${label}`, error);
		}
		const view = pursuitId ? await engine.view(pursuitId) : null;
		if (!view) return;
		const lastClaim = view.verifications
			.filter((v) => v.trigger === "claim")
			.at(-1);
		notifyEnd(
			goal,
			lastClaim
				? { passed: lastClaim.passed, criteria: lastClaim.criteria }
				: null,
			pursuitEnding(view),
		);
		await finishRecord((usage) => measure(view, usage), error);
	}

	let runFailure: Error | null = null;
	try {
		const queue = [...jobs];
		const workers = await Promise.allSettled(
			Array.from({ length: concurrency }, async () => {
				for (let job = queue.shift(); job; job = queue.shift()) {
					try {
						meter.assertWithinLimit();
					} catch (e) {
						console.error(errorText(e));
						queue.length = 0;
						return;
					}
					const identity = {
						task: job.task.id,
						condition: job.condition,
						repeat: job.repeat,
						configId: effectiveConfigs.get(job.condition)!.id,
					};
					appendFileSync(
						join(root, "job-events.jsonl"),
						JSON.stringify({
							...identity,
							status: "started",
							at: new Date().toISOString(),
						}) + "\n",
					);
					let jobError: string | null = null;
					try {
						const state = await runOne(job);
						if (state === "paused") {
							queue.length = 0;
							jobError = "paused_for_resume";
						}
					} catch (error) {
						jobError = errorText(error);
						queue.length = 0;
						throw error;
					} finally {
						const record = readRecords().find(
							(r) =>
								recordKey(r) ===
								jobKey(
									identity.task,
									identity.condition,
									identity.configId,
									identity.repeat,
								),
						);
						appendFileSync(
							join(root, "job-events.jsonl"),
							JSON.stringify({
								...identity,
								status: record
									? "recorded"
									: jobError === "paused_for_resume"
										? "paused"
										: "record_missing",
								error: record?.error ?? jobError,
								at: new Date().toISOString(),
							}) + "\n",
						);
					}
				}
			}),
		);
		const failure = workers.find((worker) => worker.status === "rejected");
		if (failure?.status === "rejected")
			throw redactError(failure.reason, secrets);
	} catch (error) {
		runFailure = redactError(error, secrets);
	} finally {
		const failures: Error[] = [];
		// Keep cleanup ordered and attempt every step, even if the remote lease cannot be released.
		for (const cleanup of [
			() => lease?.release(),
			() => store.close(),
			() => console.log(`spent so far $${meter.spentUsd().toFixed(3)}`),
			() => settings.close(),
			() => writeSummary(),
		]) {
			try {
				await cleanup();
			} catch (error) {
				failures.push(redactError(error, secrets));
			}
		}
		for (const failure of runFailure ? failures : failures.slice(1))
			console.error(`[cleanup] ${failure.name}: ${failure.message}`);
		runFailure ??= failures[0] ?? null;
	}
	if (runFailure) throw runFailure;
}
