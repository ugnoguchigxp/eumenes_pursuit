import type {
	ArtifactRef,
	CriterionResult,
	DecidedBy,
	DecisionKind,
	JsonObject,
	LedgerDb,
	PursuitStatus,
	Report,
	StepResult,
} from "../../contracts/index.ts";
import { hypothesisRequest, planRequest } from "../generation/prompts.ts";
import * as ledger from "../ledger/index.ts";
import type { PursuitView } from "../ledger/types.ts";
import { acceptancePassed } from "../rules/acceptance.ts";
import { executed } from "../rules/checks.ts";
import type { EngineCtx, EngineSteps } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import { normalPath, raceAcceptance } from "./helpers.ts";

export function makeTransitions(
	ctx: EngineCtx,
): Pick<
	EngineSteps,
	"finish" | "stepBack" | "consult" | "plan" | "hypothesize"
> {
	const {
		deps,
		store,
		clock,
		ids,
		warn,
		result,
		inference,
		llmRow,
		call,
		checkTime,
	} = ctx;
	async function finish(
		view: PursuitView,
		runtime: PursuitRuntime,
		outcome: Report["outcome"],
		reason: string,
		decidedBy: DecidedBy,
		signal: AbortSignal,
		known?: readonly CriterionResult[],
		basisExtra: JsonObject = {},
	): Promise<StepResult> {
		const deferred = outcome !== "completed";
		if (!deferred) checkTime(view, signal);
		const criteria = deferred
			? []
			: (known ?? (await runtime.acceptance.verify(signal)));
		if (!deferred) checkTime(view, signal);
		const verified = acceptancePassed(view.acceptance, criteria);
		const refs = new Map<string, ArtifactRef>();
		for (const a of view.attempts) for (const r of a.refs) refs.set(r.uri, r);
		const report: Report = {
			pursuitId: view.id,
			outcome,
			verified,
			reason,
			criteria,
			needs:
				outcome === "completed"
					? []
					: view.consultations.map((c) => c.missing).filter(Boolean),
			refs: [...refs.values()],
			stats: {
				attempts: view.attempts.filter(
					(a) => executed(a) || a.state === "started",
				).length,
				rejected: view.attempts.filter((a) => a.state === "rejected").length,
				hypotheses: view.hypotheses.length,
				strategies: view.strategies.length,
				stepBacks: view.decisions.filter((d) => d.kind === "step_back").length,
				consultations: view.consultations.length,
			},
			findings: {
				total: view.findings.filter((f) => f.status === "active").length,
				checked: view.findings
					.filter(
						(f) =>
							f.status === "active" &&
							f.kind !== "dead_end" &&
							f.assurance !== "unverified",
					)
					.map((f) => ({
						kind: f.kind,
						statement: f.statement,
						assurance: f.assurance,
					})),
			},
		};
		const status: PursuitStatus = outcome;
		const kind: DecisionKind =
			outcome === "completed"
				? "complete"
				: outcome === "incomplete"
					? "give_up"
					: "stop";
		const revision = await store.write((db) => {
			for (const a of view.attempts)
				if (a.state === "started")
					ledger.interruptAttempt(db, { id: a.id, now: clock.now() });
			ledger.closeSettlements(db, view.id, reason);
			if (!deferred)
				ledger.insertVerification(db, {
					id: ids.next("ver"),
					pursuitId: view.id,
					row: {
						attemptId: null,
						trigger: "final",
						passed: verified,
						criteria,
					},
					now: clock.now(),
				});
			ledger.insertDecision(db, {
				id: ids.next("dec"),
				pursuitId: view.id,
				kind,
				reason,
				basis: { verified, ...basisExtra },
				decidedBy,
				now: clock.now(),
			});
			ledger.insertReport(db, {
				pursuitId: view.id,
				report: deferred ? { ...report, verificationIssue: "pending" } : report,
				now: clock.now(),
			});
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status,
				finished: true,
			});
		});
		if (!deferred) return result(view, revision, status, "finished");

		// Save terminal state before calling a fallible external verifier. Abort also
		// ends our wait when a host verifier fails to honor its signal.
		let finalReport: Report;
		try {
			signal.throwIfAborted();
			if (known) {
				finalReport = {
					...report,
					criteria: known,
					verified: acceptancePassed(view.acceptance, known),
				};
			} else {
				const raced = await raceAcceptance(signal, () =>
					runtime.acceptance.verify(signal),
				);
				if (raced.issue) {
					finalReport = { ...report, verificationIssue: raced.issue };
					warn("final_verification_unavailable", {
						pursuitId: view.id,
						issue: raced.issue,
					});
				} else {
					finalReport = {
						...report,
						criteria: raced.criteria,
						verified: acceptancePassed(view.acceptance, raced.criteria),
					};
				}
			}
		} catch {
			const issue = signal.aborted ? "aborted" : "failed";
			finalReport = { ...report, verificationIssue: issue };
			warn("final_verification_unavailable", { pursuitId: view.id, issue });
		}
		const finalRevision = await store.write((db) => {
			ledger.insertVerification(db, {
				id: ids.next("ver"),
				pursuitId: view.id,
				row: {
					attemptId: null,
					trigger: "final",
					passed: finalReport.verified,
					criteria: finalReport.criteria,
				},
				now: clock.now(),
			});
			ledger.updateReport(db, { pursuitId: view.id, report: finalReport });
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: revision,
				now: clock.now(),
			});
		});
		return result(view, finalRevision, status, "finished");
	}

	async function stepBack(
		view: PursuitView,
		reason: string,
		decidedBy: DecidedBy,
		basis: JsonObject,
	): Promise<StepResult> {
		const revision = await store.write((db) => {
			ledger.closeSettlements(db, view.id, reason);
			ledger.insertDecision(db, {
				id: ids.next("dec"),
				pursuitId: view.id,
				kind: "step_back",
				reason,
				basis,
				decidedBy,
				now: clock.now(),
			});
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status: "reviewing",
			});
		});
		return result(view, revision, "reviewing", "stepped_back");
	}

	async function consult(
		view: PursuitView,
		question: string,
		missing: string,
		decidedBy: DecidedBy,
		extra: (db: LedgerDb) => void = () => {},
		basisExtra: JsonObject = {},
	): Promise<StepResult> {
		const revision = await store.write((db) => {
			extra(db);
			ledger.closeSettlements(db, view.id, question);
			ledger.insertConsultation(db, {
				id: ids.next("con"),
				pursuitId: view.id,
				question,
				missing,
				options: [],
				now: clock.now(),
			});
			ledger.insertDecision(db, {
				id: ids.next("dec"),
				pursuitId: view.id,
				kind: "consult",
				reason: question,
				basis: { missing, ...basisExtra },
				decidedBy,
				now: clock.now(),
			});
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status: "awaiting_consultation",
			});
		});
		return result(view, revision, "awaiting_consultation", "consult_requested");
	}

	async function plan(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult> {
		const last = view.decisions.at(-1);
		const direction =
			last?.kind === "revise_strategy" &&
			typeof last.basis.direction === "string"
				? last.basis.direction
				: null;
		const r = await call(
			deps.generator,
			planRequest({ view, tools: runtime.tools.list(), direction }),
			signal,
			view,
		);
		const strategyId = ids.next("str");
		const revision = await store.write((db) => {
			ledger.insertStrategy(db, {
				id: strategyId,
				pursuitId: view.id,
				body: r.value.strategy,
				rationale: r.value.rationale,
				alternatives: r.value.alternatives,
				parts: r.value.parts ?? [],
				previousId: view.currentStrategyId,
				now: clock.now(),
			});
			inference(db, view, [llmRow("plan", r)]);
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status: "hypothesizing",
				currentStrategyId: strategyId,
				currentHypothesisId: null,
			});
		});
		return result(view, revision, "hypothesizing", "planned");
	}

	async function hypothesize(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult> {
		const r = await call(
			deps.generator,
			hypothesisRequest({ view, tools: runtime.tools.list() }),
			signal,
			view,
		);
		checkTime(view, signal);
		const checkpoint = runtime.workspace
			? await runtime.workspace.checkpoint()
			: null;
		const policy = view.input.policy;
		const hypothesisId = ids.next("hyp");
		const revision = await store.write((db) => {
			ledger.insertHypothesis(db, {
				id: hypothesisId,
				pursuitId: view.id,
				strategyId: view.currentStrategyId!,
				body: r.value.hypothesis,
				rationale: r.value.rationale,
				tools: r.value.tools,
				targets: r.value.targets.map(normalPath).filter(Boolean),
				expected: r.value.expected,
				budget: view.input.conditions.rules
					? policy.budget.attemptsPerHypothesis
					: policy.budget.attempts,
				checkpoint,
				now: clock.now(),
			});
			inference(db, view, [llmRow("hypothesize", r)]);
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
				status: "proposing",
				currentHypothesisId: hypothesisId,
			});
		});
		return result(view, revision, "proposing", "hypothesized");
	}
	return { finish, stepBack, consult, plan, hypothesize };
}
