import { totalUsage, type UsageScope } from "../standalone/usage.ts";
import { jobKey, recordKey } from "./run-config.ts";
import {
	cancelWithDeadline,
	stepWithDeadline,
} from "../standalone/deadline.ts";
import type { DecisionLease } from "../standalone/larm/connection.ts";
import type { Settings, SettingValue } from "../standalone/settings.ts";
import type { StandaloneStore } from "../standalone/store.ts";
import {
	appendFileSync,
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
	readonly pricing: SettingValue<"spend.pricing">;
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
		pricing,
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
		const scope: UsageScope = {
			runId: values.name!,
			configId,
			jobId: crypto.randomUUID(),
			pursuitId: null,
			...(values["budget-id"] ? { budgetId: values["budget-id"] } : {}),
		};
		const label = `${task.id}/${condition}/${variant}/#${repeat}`;
		const started = Date.now();
		const goal = oracleGoal(task.goalFor?.(toolTier) ?? task.goal, claimOracle);
		// Outside the project, so task code cannot reach .env by a relative path.
		const directory = mkdtempSync(
			join(tmpdir(), `eumenes-pursuit-${task.id}-${condition}-${repeat}-`),
		);
		console.log(`[start] ${label} workspace ${directory}`);
		const instance = await task.create(directory, {
			grader: graderFor(scope),
			toolTier,
			critic: values.critic ? reviewerFor(scope, "critic") : null,
			rubricDir,
			secretDir,
			corpus,
		});
		const controller = new AbortController();
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
			measured: ReturnType<typeof measure>,
			error: string | null,
		) => {
			const facts = instance.outcomeFacts
				? await instance.outcomeFacts().catch(() => null)
				: null;
			const folded = withDiagnostics(
				withOutcomeFacts(measured, facts),
				instance.diagnostics?.() ?? null,
			);
			const usage = totalUsage(meter.events(scope.jobId));
			const record: RunRecord = {
				...folded,
				llmCalls: usage.calls,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				usd: usage.usd,
				usage,
				...common,
				configId,
				jobKey: jobKey(task.id, condition, configId, repeat),
				correct: isCorrect(task.expected, { ...folded, error }),
				durationMs: Date.now() - started,
				error,
			};
			appendFileSync(runsPath, `${JSON.stringify(record)}\n`);
			if (!values["keep-work"]) await instance.dispose();
			console.log(
				`[done] ${label}: ${record.outcome}${record.verified ? " (verified)" : ""}${record.verificationIssue ? ` (final verification ${record.verificationIssue}: not judged)` : ""} correct=${record.correct} tools=${record.toolCalls} requests=${record.responderRequests} stepBacks=${record.stepBacks} $${record.usd === null ? "unknown" : record.usd.toFixed(4)} ${Math.round(record.durationMs / 1000)}s`,
			);
		};
		if (condition === "D0") {
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
					grant: task.grant,
					tools: redactTools(instance.tools, secrets),
					workspace: instance.workspace,
					acceptancePort: oracleAcceptance(
						redactAcceptance(instance.acceptance, secrets),
						claimOracle,
					),
					claimLimit: claimOracle.limit,
					llm: generatorFor(scope),
					budget: {
						toolCalls: policy.budget.attempts,
						wallMs: policy.budget.wallMs,
						requests: Math.min(policy.budget.transitions, maxSteps),
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
			await finishRecord(
				measureDirect(result, id, (model) => pricing[model]),
				error,
			);
			return;
		}
		const engine = engineFor(scope);
		let pursuitId = "";
		let error: string | null = null;
		try {
			const startedPursuit = await engine.start(
				{
					goal,
					acceptance: task.acceptance,
					grant: task.grant,
					policy,
					conditions: conditionsFor(condition, conditionFlags),
					goalRef: null,
					label: task.id,
					...(experience.length ? { experience } : {}),
				},
				// Every execution is a new pursuit; a rerun never resumes an old ledger entry.
				`${values.name}:${label}:${crypto.randomUUID()}`,
			);
			if (startedPursuit.replayed) throw new Error("unexpected_replay");
			pursuitId = startedPursuit.pursuitId;
			scope.pursuitId = pursuitId;
			const runtime = {
				tools: redactTools(instance.tools, secrets),
				workspace: instance.workspace,
				acceptance: oracleAcceptance(
					redactAcceptance(instance.acceptance, secrets),
					claimOracle,
				),
			};
			for (let i = 0; i < maxSteps; i++) {
				const step = await stepWithDeadline(
					engine,
					pursuitId,
					runtime,
					controller.signal,
				);
				if (step.done) break;
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
		await finishRecord(
			measure(view, (model) => pricing[model]),
			error,
		);
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
						await runOne(job);
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
								status: record ? "recorded" : "record_missing",
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
