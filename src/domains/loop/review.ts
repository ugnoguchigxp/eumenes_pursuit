import type {
	DecidedBy,
	DecisionKind,
	JsonObject,
	PursuitStatus,
	StepResult,
} from "../../contracts/index.ts";
import {
	budgetCounted,
	reviewRequest,
	type Review,
} from "../generation/prompts.ts";
import { moreCautious } from "../judge/interpret.ts";
import { reviewState } from "../judge/state.ts";
import * as ledger from "../ledger/index.ts";
import type { InferenceRow, PursuitView } from "../ledger/types.ts";
import { attemptsOf, isScratchPath } from "../rules/checks.ts";
import {
	consultedWithoutProgress,
	describeUnfinished,
	unfinishedParts,
} from "../rules/parts.ts";
import type { EngineCtx, EngineSteps } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import {
	damaging,
	decidedByLabel,
	hypothesisHeld,
	reviewKinds,
} from "./helpers.ts";

export function makeReview(ctx: EngineCtx): Pick<EngineSteps, "review"> {
	const {
		deps,
		store,
		clock,
		ids,
		read,
		result,
		inference,
		llmRow,
		call,
		askJudge,
		writeJudgements,
		recordDeadEnd,
		featuresOf,
		firedSignals,
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
	return { review };
}
