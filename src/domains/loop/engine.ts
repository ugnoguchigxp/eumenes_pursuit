import {
	LlmOutputError,
	startInputSchema,
	terminalStatuses,
	type AcceptancePort,
	type Clock,
	type IdSource,
	type JsonObject,
	type JsonValue,
	type JudgePort,
	type LlmPort,
	type LlmRequest,
	type LlmResult,
	type PursuitStatus,
	type PursuitStore,
	type Report,
	type StepResult,
	type ToolPort,
	type ToolOutcome,
	type WorkspacePort,
} from "../../contracts/index.ts";
import * as ledger from "../ledger/index.ts";
import { decisionSchema } from "../generation/productive.ts";
import type { PursuitView } from "../ledger/types.ts";
import {
	acceptanceEvidenceUnavailable,
	acceptancePassed,
} from "../rules/acceptance.ts";
import { pursuitBudgetExceeded, remainingWallMs } from "../rules/checks.ts";
import { digestJson } from "../rules/fingerprint.ts";
import { makeAttempt } from "./attempt.ts";
import { makeBase, type EngineCtx } from "./context.ts";
import { budgetReasons, raceAcceptance, WallTimeExpired } from "./helpers.ts";
import { makePropose } from "./propose.ts";
import { makeReview } from "./review.ts";
import { makeSupport } from "./support.ts";
import { makeTransitions } from "./transitions.ts";
import { makeProductive } from "./productive.ts";

/** What the host lends for one pursuit. In Eumenes: toolchain, workspace, verifier. */
export interface PursuitRuntime {
	readonly tools: ToolPort;
	readonly workspace: WorkspacePort | null;
	readonly acceptance: AcceptancePort;
}

export interface EngineDeps {
	readonly store: PursuitStore;
	readonly clock: Clock;
	readonly ids: IdSource;
	readonly generator: LlmPort;
	/** A separate context; required when conditions.review is on. */
	readonly reviewer: LlmPort | null;
	/** Required when conditions.judge is on. */
	readonly judge: JudgePort | null;
	readonly onWarning?: (code: string, detail: JsonObject) => void;
}

export interface PursuitEngine {
	/** Read the saved request. The host dispatches it once, outside the serialized writer. */
	decisionRequest(
		pursuitId: string,
		operationId: string,
	): Promise<LlmRequest<unknown>>;
	/** Adopt a controller response without executing tools or inference a second time. */
	completeDecision(
		pursuitId: string,
		operationId: string,
		response: LlmResult<unknown>,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	/** Adopt one confirmed result of a host-queued tool; never invokes that tool again. */
	completeTool(
		pursuitId: string,
		attemptId: string,
		operationId: string,
		outcome: ToolOutcome,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	start(
		input: unknown,
		operationKey: string,
	): Promise<{ pursuitId: string; replayed: boolean }>;
	step(
		pursuitId: string,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	answer(
		pursuitId: string,
		consultationId: string,
		answer: string,
	): Promise<StepResult>;
	cancel(
		pursuitId: string,
		reason: string,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	/** Retry only an unfinished final verification. Does not rerun tools or promote stopped work. */
	reverify(
		pursuitId: string,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	view(pursuitId: string): Promise<PursuitView | null>;
}

export { citationNote } from "./helpers.ts";

export function createPursuitEngine(deps: EngineDeps): PursuitEngine {
	const base = makeBase(deps);
	const { store, clock, ids } = deps;
	const { read, result, checkTime } = base;
	const ctx = { ...base, ...makeSupport(base) } as EngineCtx;
	Object.assign(
		ctx,
		makeTransitions(ctx),
		makePropose(ctx),
		makeAttempt(ctx),
		makeReview(ctx),
		makeProductive(ctx),
	);

	return {
		async decisionRequest(pursuitId, operationId) {
			const view = await read(pursuitId);
			const request = view.productive?.request;
			if (!request || request.id !== operationId)
				throw new Error("decision_not_pending");
			return {
				purpose: "propose",
				system: request.system,
				prompt: request.prompt,
				maxOutputTokens: request.maxOutputTokens,
				schema: decisionSchema(view),
			};
		},
		async completeDecision(pursuitId, operationId, response, runtime, signal) {
			const view = await read(pursuitId);
			const key = `controller-result:${operationId}`;
			const receipt = await store.readSnapshot((db) =>
				ledger.findPursuitByOperation(db, key),
			);
			if (receipt) {
				if (receipt !== pursuitId) throw new Error("decision_pursuit_mismatch");
				await store.write((db) =>
					ledger.claimOperation(db, {
						key,
						kind: "controller_result",
						digest: digestJson(response as unknown as JsonValue),
						pursuitId,
						now: clock.now(),
					}),
				);
				return ctx.productiveResult(
					result(view, view.revision, view.status, "executed"),
					runtime,
				);
			}
			if (
				terminalStatuses.includes(view.status) ||
				view.productive?.request?.id !== operationId
			)
				throw new Error("decision_not_pending");
			try {
				return await ctx.productive(view, runtime, signal, {
					operationId,
					response,
				});
			} catch (error) {
				if (!(error instanceof WallTimeExpired)) throw error;
				return this.step(pursuitId, runtime, signal);
			}
		},
		async completeTool(
			pursuitId,
			attemptId,
			operationId,
			outcome,
			runtime,
			signal,
		) {
			const view = await read(pursuitId);
			const completed = await ctx.completeTool(
				view,
				runtime,
				attemptId,
				operationId,
				outcome,
				signal,
			);
			return view.input.conditions.execution === "productive"
				? ctx.productiveResult(completed, runtime)
				: completed;
		},
		async start(input, operationKey) {
			const start = startInputSchema.parse(input);
			if (start.conditions.judge && !deps.judge)
				throw new Error("judge_required");
			if (start.conditions.review && !deps.reviewer)
				throw new Error("reviewer_required");
			if (start.conditions.execution === "productive" && !deps.reviewer)
				throw new Error("reviewer_required");
			const pursuitId = ids.next("pur");
			return store.write((db) => {
				const claimed = ledger.claimOperation(db, {
					key: operationKey,
					kind: "start",
					// An absent optional field drops out of the JSON, so older digests still match.
					digest: digestJson(start as JsonValue),
					pursuitId,
					now: clock.now(),
				});
				if (claimed.replayed)
					return { pursuitId: claimed.pursuitId, replayed: true };
				ledger.insertPursuit(db, {
					id: pursuitId,
					start,
					status: "planning",
					now: clock.now(),
				});
				return { pursuitId, replayed: false };
			});
		},

		async step(pursuitId, runtime, signal) {
			const view = await read(pursuitId);
			if (terminalStatuses.includes(view.status))
				return result(view, view.revision, view.status, "finished");
			const started = view.attempts.find((a) => a.state === "started");
			if (
				started &&
				!started.pendingOperationId &&
				view.input.conditions.execution !== "productive"
			) {
				// No restore: earlier successful attempts of the hypothesis keep their effects.
				const revision = await store.write((db) => {
					ledger.setActionPlan(db, view.id, null);
					ledger.interruptAttempt(db, { id: started.id, now: clock.now() });
					return ledger.advancePursuit(db, {
						id: view.id,
						expectedRevision: view.revision,
						now: clock.now(),
					});
				});
				return result(view, revision, view.status, "interrupted");
			}
			if (view.status === "awaiting_consultation")
				return result(view, view.revision, view.status, "consult_requested");

			try {
				checkTime(view, signal);
				if (view.input.conditions.execution === "productive")
					return await ctx.productive(view, runtime, signal);
				if (started?.pendingOperationId)
					return {
						...result(view, view.revision, view.status, "waiting_tool"),
						pendingTool: {
							attemptId: started.id,
							operationId: started.pendingOperationId,
						},
					};
				const pending = view.attempts.find(
					(a) =>
						a.state === "settled" &&
						a.settlement &&
						a.settlement.stage !== "done",
				);
				if (pending)
					return await ctx.resumeSettlement(view, runtime, pending.id, signal);
				const over = pursuitBudgetExceeded(view, clock.now());
				if (over)
					return ctx.finish(
						view,
						runtime,
						"stopped",
						budgetReasons[over],
						"rules",
						signal,
					);
				switch (view.status) {
					case "planning":
						return await ctx.plan(view, runtime, signal);
					case "hypothesizing":
						return await ctx.hypothesize(view, runtime, signal);
					case "proposing":
						return await ctx.propose(view, runtime, signal);
					case "reviewing":
						return await ctx.review(view, runtime, signal);
					default:
						throw new Error(`pursuit_status_unhandled:${view.status}`);
				}
			} catch (error) {
				if (
					error instanceof WallTimeExpired ||
					(signal.aborted && remainingWallMs(view, clock.now()) <= 0)
				) {
					// Already-expired verifier must not extend shutdown; finish persists first.
					const expired = new AbortController();
					expired.abort();
					return ctx.finish(
						await read(pursuitId),
						runtime,
						"stopped",
						budgetReasons.wall_time,
						"rules",
						expired.signal,
					);
				}
				if (!(error instanceof LlmOutputError)) throw error;
				return ctx.finish(
					await read(pursuitId),
					runtime,
					"stopped",
					`LLM の出力を受け取れませんでした（${error.reasonCode}）`,
					"rules",
					signal,
				);
			}
		},

		async answer(pursuitId, consultationId, answer) {
			const view = await read(pursuitId);
			if (view.status !== "awaiting_consultation")
				throw new Error("pursuit_not_awaiting_consultation");
			const hypothesis = view.hypotheses.find(
				(h) => h.id === view.currentHypothesisId,
			);
			const strategy = view.strategies.find(
				(s) => s.id === view.currentStrategyId,
			);
			const status: PursuitStatus =
				hypothesis?.status === "active"
					? "proposing"
					: strategy?.status === "active"
						? "hypothesizing"
						: "planning";
			const revision = await store.write((db) => {
				ledger.answerConsultation(db, {
					id: consultationId,
					pursuitId,
					answer,
					now: clock.now(),
				});
				return ledger.advancePursuit(db, {
					id: pursuitId,
					expectedRevision: view.revision,
					now: clock.now(),
					status,
				});
			});
			return result(view, revision, status, "consult_answered");
		},

		async cancel(pursuitId, reason, runtime, signal) {
			const view = await read(pursuitId);
			if (terminalStatuses.includes(view.status))
				return result(view, view.revision, view.status, "finished");
			return ctx.finish(view, runtime, "stopped", reason, "human", signal);
		},

		async reverify(pursuitId, runtime, signal) {
			const view = await read(pursuitId);
			if (!terminalStatuses.includes(view.status) || !view.report)
				throw new Error("final_verification_requires_terminal");
			if (!view.report.verificationIssue)
				return result(view, view.revision, view.status, "finished");
			signal.throwIfAborted();
			const raced = await raceAcceptance(signal, () =>
				runtime.acceptance.verify(signal),
			);
			const criteria = raced.criteria;
			const issue =
				raced.issue ??
				(acceptanceEvidenceUnavailable(view.acceptance, criteria)
					? "evidence_unavailable"
					: null);
			const { verificationIssue: _previous, ...previous } = view.report;
			const report: Report = {
				...previous,
				criteria,
				verified: !issue && acceptancePassed(view.acceptance, criteria),
				...(issue ? { verificationIssue: issue } : {}),
			};
			const revision = await store.write((db) => {
				ledger.insertVerification(db, {
					id: ids.next("ver"),
					pursuitId: view.id,
					row: {
						attemptId: null,
						trigger: "final",
						passed: report.verified,
						criteria,
					},
					now: clock.now(),
				});
				ledger.updateReport(db, { pursuitId: view.id, report });
				return ledger.advancePursuit(db, {
					id: view.id,
					expectedRevision: view.revision,
					now: clock.now(),
				});
			});
			return result(view, revision, view.status, "finished");
		},

		async view(pursuitId) {
			return store.readSnapshot((db) => ledger.loadPursuit(db, pursuitId));
		},
	};
}
