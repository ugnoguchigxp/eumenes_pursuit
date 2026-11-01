import {
	LlmOutputError,
	startInputSchema,
	terminalStatuses,
	type AcceptancePort,
	type ArtifactRef,
	type Clock,
	type CriterionResult,
	type DecidedBy,
	type DecisionKind,
	type IdSource,
	type JsonObject,
	type JsonValue,
	type JudgePort,
	type LedgerDb,
	type LlmPort,
	type LlmRequest,
	type LlmResult,
	type PursuitStatus,
	type PursuitStore,
	type Report,
	type StepEvent,
	type StepResult,
	type ToolDescriptor,
	type ToolOutcome,
	type ToolPort,
	type WorkspacePort,
	type WorkspaceChanges,
} from "../../contracts/index.ts";
import {
	findQuestionSet,
	stageQuestions,
	type Stage,
} from "../judge/question-sets.ts";
import {
	interpret,
	moreCautious,
	type JudgeEffects,
} from "../judge/interpret.ts";
import { postState, preState, reviewState } from "../judge/state.ts";
import {
	attemptTally,
	hypothesisRequest,
	planRequest,
	verdictText,
	budgetCounted,
	proposalRequest,
	reviewRequest,
	type Proposal,
	type Review,
} from "../generation/prompts.ts";
import * as ledger from "../ledger/index.ts";
import {
	consultedWithoutProgress,
	describeUnfinished,
	unfinishedParts,
} from "../rules/parts.ts";
import type {
	AttemptFeatures,
	InferenceRow,
	JudgementRow,
	Prediction,
	PursuitView,
	Rejection,
} from "../ledger/types.ts";
import { acceptancePassed } from "../rules/acceptance.ts";
import { refutationHeld } from "../rules/refutation.ts";
import {
	attemptOutcome,
	attemptsOf,
	executed,
	invariantRejections,
	isScratchPath,
	pursuitBudgetExceeded,
	remainingWallMs,
	rejectionsInRow,
	ruleRejections,
	signals,
	unrecordedFindingRefs,
	type Signal,
} from "../rules/checks.ts";
import {
	citationNote,
	damaging,
	decidedByLabel,
	budgetReasons,
	findingRefs,
	hypothesisHeld,
	noChanges,
	normalPath,
	reviewKinds,
	sentenceClip,
	trajectoryStreak,
	WallTimeExpired,
} from "./helpers.ts";
import { makeAttempt } from "./attempt.ts";
import { makePropose } from "./propose.ts";
import type { EngineCtx } from "./context.ts";
import { makeTransitions } from "./transitions.ts";
import { makeSupport } from "./support.ts";
import { makeBase } from "./context.ts";
import {
	digestJson,
	fingerprint,
	sameConditions,
} from "../rules/fingerprint.ts";

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
	view(pursuitId: string): Promise<PursuitView | null>;
}

export { citationNote } from "./helpers.ts";

export function createPursuitEngine(deps: EngineDeps): PursuitEngine {
	const base = makeBase(deps);
	const { store, clock, ids } = deps;
	const { read, result } = base;
	const ctx = { ...base, ...makeSupport(base) } as EngineCtx;
	Object.assign(ctx, makeTransitions(ctx), makePropose(ctx), makeAttempt(ctx), {
		review,
	});
	const {
		warn,
		inference,
		llmRow,
		call,
		checkTime,
		askJudge,
		recordFindings,
		recordDeadEnd,
		checkedFindings,
		writeJudgements,
		featuresOf,
		changingTools,
		firedSignals,
		reject,
	} = ctx;
	async function review(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult> {
		const conditions = view.input.conditions;
		const policy = view.input.policy;
		const tools = runtime.tools.list();
		const hypothesis = view.hypotheses.find(
			(h) => h.id === view.currentHypothesisId,
		);
		const strategy = view.strategies.find(
			(s) => s.id === view.currentStrategyId,
		);
		const reason =
			[...view.decisions].reverse().find((d) => d.kind === "step_back")
				?.reason ?? "";
		const fired = firedSignals(view, tools);
		const usage: InferenceRow[] = [];
		let reviewed: Review | null = null;
		if (conditions.review && deps.reviewer) {
			const r = await call(
				deps.reviewer,
				reviewRequest({
					view,
					reason,
					signals: fired.map((s) => s.code),
					tools,
				}),
				signal,
				view,
			);
			reviewed = r.value;
			usage.push(llmRow("review", r));
		}
		const judged = await askJudge(
			view,
			"review",
			reviewState({ view, reason, fired }),
			null,
			signal,
		);
		const fromReview = reviewed ? reviewKinds[reviewed.decision] : null;
		const fromJudge = judged?.effects.next ?? null;
		let kind: DecisionKind = fromReview ?? fromJudge ?? "change_hypothesis";
		let decidedBy: DecidedBy = fromReview
			? "review"
			: fromJudge
				? "judge"
				: "rules";
		if (fromReview && fromJudge) {
			kind = moreCautious(fromReview, fromJudge);
			decidedBy = kind === fromReview ? "review" : "judge";
		}
		const budgetLeft =
			hypothesis !== undefined &&
			budgetCounted(view, attemptsOf(view, hypothesis.id), runtime.tools.list())
				.length < hypothesis.budget;
		const lastStepBack = [...view.decisions]
			.reverse()
			.find((d) => d.kind === "step_back");
		// A step back forced by the rules or a guard cannot be undone by "keep going".
		if (
			(kind === "continue" || kind === "change_tool") &&
			(!budgetLeft || (lastStepBack && lastStepBack.decidedBy !== "generator"))
		)
			kind = "change_hypothesis";
		const escalation: string[] = [];
		let unfinishedNote = "";
		if (conditions.rules) {
			const stepBacks = view.decisions.filter(
				(d) => d.kind === "step_back",
			).length;
			const answered = view.consultations.filter(
				(c) => c.answer !== null,
			).length;
			const inStrategy = view.hypotheses.filter(
				(h) => h.strategyId === strategy?.id,
			).length;
			// An answered consultation with nothing tried since: asking again spins.
			if (
				kind === "consult" &&
				policy.consultation.requireProgress &&
				consultedWithoutProgress(view)
			) {
				kind = "change_hypothesis";
				decidedBy = "rules";
				escalation.push("consult_without_progress");
			}
			if (
				kind === "change_hypothesis" &&
				inStrategy >= policy.budget.hypothesesPerStrategy
			) {
				kind = "revise_strategy";
				escalation.push("hypotheses_per_strategy");
			}
			// A strategy is kept until its parts are worked through (spec/persistence-design.md §2).
			if (
				conditions.selfCheck === "parts" &&
				kind === "revise_strategy" &&
				strategy &&
				inStrategy < policy.budget.hypothesesPerStrategy
			) {
				const unfinished = unfinishedParts(strategy);
				if (unfinished.length) {
					kind = "change_hypothesis";
					decidedBy = "rules";
					escalation.push("strategy_not_exhausted");
					unfinishedNote = describeUnfinished(unfinished);
				}
			}
			if (
				kind === "revise_strategy" &&
				view.strategies.length >= policy.budget.strategies
			) {
				kind = "consult";
				escalation.push("strategies");
			}
			if (stepBacks > policy.budget.stepBacks && kind !== "stop") {
				kind = answered > 0 ? "stop" : "consult";
				escalation.push("step_backs");
			}
			if (kind === "consult" && answered >= 2) {
				kind = "stop";
				escalation.push("consultations");
			}
			// A budget escalation back to consult would ask again with nothing tried since.
			if (
				kind === "consult" &&
				escalation.includes("consult_without_progress")
			) {
				kind = "stop";
				escalation.push("consultations");
			}
		}
		const direction =
			unfinishedNote && kind === "change_hypothesis"
				? `残りの部品に取り組む: ${unfinishedNote}`
				: (reviewed?.direction ?? "");
		const why = reviewed?.reason || reason;
		// A review that kept the strategy, turned into a new plan only because the strategy's
		// hypothesis budget is spent (spec/fixes-2026-10-22-f.md §A): the strategy did not fail.
		const continuation =
			kind === "revise_strategy" &&
			reviewed?.decision === "continue_strategy" &&
			escalation.includes("hypotheses_per_strategy");
		// How the hypothesis ended and who decided, so a later request does not read a reviewer's
		// reason as the hypothesis's own outcome (spec/fixes-2026-10-22-c.md §3).
		const closing = (prefix = "") =>
			`${prefix}${
				hypothesis && hypothesisHeld(view, hypothesis.id, lastStepBack, fired)
					? "成り立ったので次へ"
					: "打ち切り"
			}（判断: ${decidedByLabel[decidedBy]}）: ${why}`;
		// rollback "notify": the reverted task files go into the decision basis, and the next
		// generator requests name them until an attempt runs (prompts.ts revertBlock). Scratch
		// work is never reverted; generated outputs are reverted and only counted.
		let revertNote: JsonObject = {};
		if (
			conditions.rules &&
			conditions.rollback === "notify" &&
			runtime.workspace &&
			hypothesis?.checkpoint &&
			kind !== "continue" &&
			kind !== "change_tool" &&
			(policy.restore === "always" || damaging(lastStepBack?.basis))
		) {
			const changes = await featuresOf(
				view,
				runtime,
				hypothesis.checkpoint,
				null,
			);
			const scratchDirs = policy.signals.scratchDirs;
			const generated = new Set(changes.generated ?? []);
			const kept = changes.filesTouched.filter((f) =>
				isScratchPath(f, scratchDirs),
			);
			const reverted = changes.filesTouched
				.filter((f) => !isScratchPath(f, scratchDirs) && !generated.has(f))
				.sort();
			await runtime.workspace.restore(hypothesis.checkpoint, {
				dirs: scratchDirs,
			});
			revertNote = {
				reverted,
				revertedGenerated: changes.filesTouched.filter(
					(f) => !isScratchPath(f, scratchDirs) && generated.has(f),
				).length,
				keptScratch: kept.length,
				attemptsAtRevert: view.attempts.length,
			};
		}
		const basis: JsonObject = {
			...revertNote,
			review: reviewed
				? {
						decision: reviewed.decision,
						brokenAssumption: reviewed.brokenAssumption,
						// Which strategy a continue_strategy correction belongs to (fixes-2026-10-22-e §4).
						...(strategy ? { strategyId: strategy.id } : {}),
					}
				: null,
			judge: fromJudge,
			signals: fired.map((s) => s.code),
			escalation,
			direction,
			...(continuation
				? {
						continuation: true,
						hypothesesPerStrategy: policy.budget.hypothesesPerStrategy,
					}
				: {}),
		};
		if (kind === "stop") {
			await store.write((db) => {
				inference(db, view, usage);
				writeJudgements(db, view, judged);
			});
			return ctx.finish(
				await read(view.id),
				runtime,
				"stopped",
				why,
				decidedBy,
				signal,
				undefined,
				revertNote,
			);
		}
		if (kind === "consult")
			return ctx.consult(
				view,
				direction || why || "どう進めるか判断してください",
				reviewed?.brokenAssumption ?? reason,
				decidedBy,
				(db) => {
					inference(db, view, usage);
					writeJudgements(db, view, judged);
					if (hypothesis?.status === "active") {
						ledger.closeHypothesis(db, {
							id: hypothesis.id,
							result: closing("相談・"),
							now: clock.now(),
						});
						if (!hypothesisHeld(view, hypothesis.id, lastStepBack, fired))
							recordDeadEnd(db, view, hypothesis.id);
					}
				},
				revertNote,
			);
		const status: PursuitStatus =
			kind === "continue" || kind === "change_tool"
				? "proposing"
				: kind === "revise_strategy"
					? "planning"
					: "hypothesizing";
		const revision = await store.write((db) => {
			inference(db, view, usage);
			writeJudgements(db, view, judged);
			if (status !== "proposing" && hypothesis?.status === "active") {
				ledger.closeHypothesis(db, {
					id: hypothesis.id,
					result: closing(),
					now: clock.now(),
				});
				if (!hypothesisHeld(view, hypothesis.id, lastStepBack, fired))
					recordDeadEnd(db, view, hypothesis.id);
			}
			if (status === "planning" && strategy?.status === "active") {
				ledger.closeStrategy(db, {
					id: strategy.id,
					reason: continuation
						? `仮説の上限（方針あたり ${policy.budget.hypothesesPerStrategy} 件）に達したので、規則で方針を立て直す。振り返りは方針${strategy.seq}の継続を勧めた（方針の誤りによる終了ではない）`
						: why,
					now: clock.now(),
				});
				// Continued in a new plan: what was found under it still stands (§A).
				if (conditions.findings !== "off" && !continuation)
					ledger.supersedeStrategyFindings(db, {
						pursuitId: view.id,
						strategyId: strategy.id,
						reason: `方針${strategy.seq}を見直した`,
						now: clock.now(),
					});
			}
			ledger.insertDecision(db, {
				id: ids.next("dec"),
				pursuitId: view.id,
				kind,
				reason: why,
				basis,
				decidedBy,
				now: clock.now(),
			});
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status,
			});
		});
		return result(view, revision, status, "stepped_back");
	}

	return {
		async start(input, operationKey) {
			const start = startInputSchema.parse(input);
			if (start.conditions.judge && !deps.judge)
				throw new Error("judge_required");
			if (start.conditions.review && !deps.reviewer)
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
			if (started) {
				// No restore: earlier successful attempts of the hypothesis keep their effects.
				const revision = await store.write((db) => {
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
						return await review(view, runtime, signal);
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

		async view(pursuitId) {
			return store.readSnapshot((db) => ledger.loadPursuit(db, pursuitId));
		},
	};
}
