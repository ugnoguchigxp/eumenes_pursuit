import type {
	CriterionResult,
	JsonObject,
	StepResult,
	ToolDescriptor,
	ToolOutcome,
} from "../../contracts/index.ts";
import { terminalStatuses } from "../../contracts/index.ts";
import { budgetCounted, type Proposal } from "../generation/prompts.ts";
import { postState, preState } from "../judge/state.ts";
import * as ledger from "../ledger/index.ts";
import type { InferenceRow, Prediction, PursuitView } from "../ledger/types.ts";
import { acceptancePassed } from "../rules/acceptance.ts";
import {
	attemptOutcome,
	attemptsOf,
	invariantRejections,
	ruleRejections,
} from "../rules/checks.ts";
import {
	digestJson,
	fingerprint,
	sameConditions,
} from "../rules/fingerprint.ts";
import type { EngineCtx, EngineSteps } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import { trajectoryStreak } from "./helpers.ts";

export function makeAttempt(
	ctx: EngineCtx,
): Pick<EngineSteps, "attempt" | "resumeSettlement" | "completeTool"> {
	const {
		store,
		clock,
		ids,
		warn,
		read,
		result,
		inference,
		checkTime,
		reject,
		recordFindings,
		askJudge,
		writeJudgements,
		featuresOf,
		firedSignals,
	} = ctx;
	async function attempt(
		view: PursuitView,
		runtime: PursuitRuntime,
		p: Proposal,
		usage: InferenceRow,
		tools: readonly ToolDescriptor[],
		signal: AbortSignal,
	): Promise<StepResult> {
		const conditions = view.input.conditions;
		const policy = view.input.policy;
		const hypothesis = view.hypotheses.find(
			(h) => h.id === view.currentHypothesisId,
		)!;
		const toolName = p.tool ?? "";
		const tool = tools.find((t) => t.name === toolName);
		let input: JsonObject = {};
		let inputError: string | null = null;
		try {
			const parsed: unknown = JSON.parse(p.inputJson ?? "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				input = parsed as JsonObject;
			else inputError = "inputJson は JSON オブジェクトにしてください";
		} catch {
			inputError = "inputJson が JSON として読めません";
		}
		// Raw text travels outside the JSON so TeX and code need no double escaping.
		if (tool?.textField && p.text !== null && p.text !== undefined)
			input = { ...input, [tool.textField]: p.text };
		const prediction: Prediction =
			conditions.prediction === "falsifiable"
				? {
						expectedStatus: p.expectedStatus ?? "ok",
						expectedObservation: p.expectedObservation ?? "",
						refutedIf: p.refutedIf ?? "",
					}
				: {
						expectedStatus: p.expectedStatus ?? "ok",
						expectedObservation: p.expectedObservation ?? "",
					};
		const digest =
			runtime.workspace &&
			(tool?.sideEffect === "workspace" || tool?.readsWorkspace)
				? await runtime.workspace.digest()
				: null;
		const fp = tool ? fingerprint(tool, input, digest) : `unknown:${toolName}`;
		const proposed = {
			tool: toolName,
			input,
			prediction,
			whatChanged: p.whatChanged,
			fingerprint: fp,
		};
		const rejections = invariantRejections({
			tool,
			toolName,
			inputError,
			grant: view.input.grant,
		});
		if (!rejections.length && conditions.rules)
			rejections.push(
				...ruleRejections({
					view,
					hypothesis,
					prediction,
					whatChanged: p.whatChanged,
					fingerprint: fp,
					sameConditions: (a) =>
						tool ? sameConditions(a, tool, input, digest) : false,
					policy,
					falsifiable: conditions.prediction === "falsifiable",
					budgetUsed: budgetCounted(
						view,
						attemptsOf(view, hypothesis.id),
						tools,
					).length,
				}),
			);
		const readBack =
			conditions.rules &&
			conditions.completionCheck === "acceptance" &&
			tool?.readsBack === true &&
			tool.sideEffect === "none";
		const pre =
			!rejections.length && tool && !readBack
				? await askJudge(
						view,
						"pre",
						preState({
							view,
							hypothesis,
							tool,
							proposal: { input, prediction },
							fired: firedSignals(view, tools),
						}),
						null,
						signal,
					)
				: null;
		if (pre) rejections.push(...pre.effects.rejections);
		if (rejections.length || !tool) {
			const revision = await reject(view, proposed, rejections, (db, id) => {
				inference(db, view, [usage]);
				if (pre)
					writeJudgements(db, view, {
						rows: pre.rows.map((row) => ({ ...row, attemptId: id })),
						usage: pre.usage,
					});
			});
			if (pre?.effects.stepBack)
				return ctx.stepBack(
					await read(view.id),
					pre.effects.stepBack,
					"judge",
					{
						stage: "pre",
					},
				);
			return result(view, revision, view.status, "rejected");
		}
		checkTime(view, signal);
		const attemptId = ids.next("att");
		const pending = await store.write((db) => {
			ledger.insertAttempt(db, {
				id: attemptId,
				pursuitId: view.id,
				hypothesisId: hypothesis.id,
				state: "started",
				...proposed,
				rejection: null,
				now: clock.now(),
			});
			inference(db, view, [usage]);
			if (pre)
				writeJudgements(db, view, {
					rows: pre.rows.map((row) => ({ ...row, attemptId })),
					usage: pre.usage,
				});
			const deferred = runtime.tools.deferInTransaction
				? runtime.tools.deferInTransaction(
						db,
						{ tool: tool.name, input },
						{ pursuitId: view.id, attemptId },
					)
				: null;
			if (deferred !== null) {
				if (!deferred || typeof deferred !== "object")
					throw new Error("invalid_deferred_tool");
				ledger.deferAttempt(db, attemptId, deferred.operationId);
			}
			const revision = ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
			});
			return { revision, operationId: deferred?.operationId ?? null };
		});
		if (pending.operationId)
			return {
				...result(view, pending.revision, view.status, "waiting_tool"),
				pendingTool: { attemptId, operationId: pending.operationId },
			};
		let outcome: ToolOutcome;
		checkTime(view, signal);
		try {
			outcome = await runtime.tools.invoke({ tool: tool.name, input }, signal);
		} catch (error) {
			if (signal.aborted) throw error;
			outcome = {
				status: "error",
				output: { message: "道具の実行中に例外が起きました" },
				errorCode: "tool_exception",
				refs: [],
			};
			warn("tool_exception", {
				tool: tool.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return acceptOutcome(
			await read(view.id),
			runtime,
			attemptId,
			outcome,
			signal,
		);
	}

	async function completeTool(
		view: PursuitView,
		runtime: PursuitRuntime,
		attemptId: string,
		operationId: string,
		outcome: ToolOutcome,
		signal: AbortSignal,
	): Promise<StepResult> {
		signal.throwIfAborted();
		const a = view.attempts.find((a) => a.id === attemptId);
		if (!a || a.pendingOperationId !== operationId)
			throw new Error("tool_operation_mismatch");
		const digest = digestJson(
			outcome as unknown as import("../../contracts/index.ts").JsonValue,
		);
		if (a.pendingResultDigest) {
			if (a.pendingResultDigest !== digest)
				throw new Error("tool_result_conflict");
			return result(
				view,
				view.revision,
				view.status,
				terminalStatuses.includes(view.status) ? "finished" : "executed",
			);
		}
		if (terminalStatuses.includes(view.status) || a.state !== "started")
			throw new Error("tool_result_not_pending");
		checkTime(view, signal);
		return acceptOutcome(view, runtime, attemptId, outcome, signal, digest);
	}

	async function acceptOutcome(
		view: PursuitView,
		runtime: PursuitRuntime,
		attemptId: string,
		outcome: ToolOutcome,
		signal: AbortSignal,
		pendingDigest?: string,
	): Promise<StepResult> {
		const a = view.attempts.find((a) => a.id === attemptId)!;
		const hypothesis = view.hypotheses.find((h) => h.id === a.hypothesisId)!;
		const features = await featuresOf(view, runtime, hypothesis.checkpoint, {
			tool: a.tool,
			input: a.input,
		});
		const awaitDigest = runtime.workspace
			? await runtime.workspace.digest()
			: null;
		const current = await read(view.id);
		if (terminalStatuses.includes(current.status))
			throw new Error("tool_result_not_pending");
		if (pendingDigest) checkTime(current, signal);
		await store.write((db) => {
			ledger.settleAttempt(db, {
				id: attemptId,
				observation: {
					status: outcome.status,
					output: outcome.output,
					errorCode: outcome.errorCode ?? null,
					...(outcome.unclipped?.length
						? { unclipped: outcome.unclipped }
						: {}),
				},
				outcome: attemptOutcome(
					a.prediction,
					outcome.status,
					null,
					view.input.policy,
				),
				refs: outcome.refs,
				features,
				settlement: {
					stage: "need_post_judge",
					digest: awaitDigest,
					effects: null,
				},
				now: clock.now(),
			});
			if (pendingDigest)
				db.query(
					"UPDATE pursuit_attempt SET pending_result_digest=? WHERE id=?",
				).run(pendingDigest, attemptId);
			recordFindings(
				db,
				current,
				(outcome.findings ?? []).map((f) => ({
					...f,
					scope: "pursuit" as const,
				})),
				attemptId,
			);
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: current.revision,
				now: clock.now(),
			});
		});
		return ctx.resumeSettlement(
			await read(view.id),
			runtime,
			attemptId,
			signal,
		);
	}

	async function resumeSettlement(
		view: PursuitView,
		runtime: PursuitRuntime,
		attemptId: string,
		signal: AbortSignal,
	): Promise<StepResult> {
		let current = view;
		let settled = current.attempts.find((a) => a.id === attemptId)!;
		let pending = settled.settlement!;
		const tools = runtime.tools.list();
		const policy = view.input.policy;
		const conditions = view.input.conditions;
		const digest = runtime.workspace ? await runtime.workspace.digest() : null;
		if (pending.digest !== digest) {
			// A paused workspace may have changed. Recompute facts and do not reuse old acceptance.
			const hyp = current.hypotheses.find((h) => h.id === settled.hypothesisId);
			const features = await featuresOf(
				current,
				runtime,
				hyp?.checkpoint ?? null,
				null,
			);
			pending = { stage: "need_post_judge", digest, effects: null };
			await store.write((db) => {
				ledger.updateSettlement(db, attemptId, pending);
				ledger.updateAttemptFeatures(db, {
					id: attemptId,
					features,
					outcome: attemptOutcome(
						settled.prediction,
						settled.observation!.status,
						null,
						policy,
					),
				});
			});
			current = await read(view.id);
			settled = current.attempts.find((a) => a.id === attemptId)!;
		}
		if (pending.stage === "need_post_judge") {
			const post = await askJudge(
				current,
				"post",
				postState({
					view: current,
					attempt: settled,
					fired: firedSignals(current, tools),
				}),
				attemptId,
				signal,
			);
			signal.throwIfAborted();
			const features = {
				...settled.features!,
				match: post?.effects.match ?? null,
				progress: post?.effects.progress ?? null,
			};
			pending = {
				...pending,
				stage: "need_acceptance",
				effects: post
					? { stepBack: post.effects.stepBack, consult: post.effects.consult }
					: null,
			};
			await store.write((db) => {
				writeJudgements(db, current, post);
				ledger.updateAttemptFeatures(db, {
					id: attemptId,
					features,
					outcome: attemptOutcome(
						settled.prediction,
						settled.observation!.status,
						features.match,
						policy,
					),
				});
				ledger.updateSettlement(db, attemptId, pending);
				ledger.advancePursuit(db, {
					id: view.id,
					expectedRevision: current.revision,
					now: clock.now(),
				});
			});
			current = await read(view.id);
		}
		if (pending.stage === "need_acceptance") {
			checkTime(current, signal);
			let criteria: readonly CriterionResult[] | null = null;
			let unavailable = false;
			if (conditions.rules && conditions.verifyOn === "attempt") {
				try {
					criteria = await runtime.acceptance.verify(signal);
				} catch (error) {
					checkTime(current, signal);
					unavailable = true;
					criteria = [];
					warn("attempt_verification_unavailable", {
						pursuitId: view.id,
						attemptId,
						error: error instanceof Error ? error.name : "error",
					});
				}
			}
			checkTime(current, signal);
			pending = {
				...pending,
				stage: "need_rules",
				...(unavailable ? { reason: "acceptance_unavailable" } : {}),
			};
			await store.write((db) => {
				if (criteria)
					ledger.insertVerification(db, {
						id: ids.next("ver"),
						pursuitId: view.id,
						row: {
							attemptId,
							trigger: "attempt",
							passed: acceptancePassed(current.acceptance, criteria),
							criteria,
						},
						now: clock.now(),
					});
				ledger.updateSettlement(db, attemptId, pending);
			});
			current = await read(view.id);
		}
		const verified = [...current.verifications]
			.reverse()
			.find((v) => v.attemptId === attemptId && v.trigger === "attempt");
		if (
			conditions.rules &&
			conditions.verifyOn === "attempt" &&
			verified?.passed
		)
			return ctx.finish(
				current,
				runtime,
				"completed",
				"照合を通過",
				"rules",
				signal,
				verified.criteria,
			);
		const fired = firedSignals(current, tools);
		if (fired.length)
			return ctx.stepBack(
				current,
				`兆候を検出: ${fired.map((s) => `${s.code}=${s.value}`).join(", ")}`,
				"rules",
				{ signals: fired.map((s) => s.code) },
			);
		const persistent =
			trajectoryStreak(current, attemptId) >= policy.judge.trajectoryPersist;
		if (pending.effects?.consult && persistent)
			return ctx.consult(
				current,
				"目標の達成に必要な情報・権限・前提が欠けているようです。補える情報はありますか？",
				pending.effects.consult,
				"judge",
			);
		if (pending.effects?.stepBack && persistent)
			return ctx.stepBack(current, pending.effects.stepBack, "judge", {
				stage: "post",
			});
		await store.write((db) =>
			ledger.updateSettlement(db, attemptId, { ...pending, stage: "done" }),
		);
		return result(current, current.revision, current.status, "executed");
	}
	return { attempt, resumeSettlement, completeTool };
}
