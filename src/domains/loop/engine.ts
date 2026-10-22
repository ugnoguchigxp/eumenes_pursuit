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
	hypothesisRequest,
	planRequest,
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
import {
	attemptOutcome,
	attemptsOf,
	executed,
	invariantRejections,
	pursuitBudgetExceeded,
	remainingWallMs,
	rejectionsInRow,
	ruleRejections,
	signals,
	type Signal,
} from "../rules/checks.ts";
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

/** Consecutive settled attempts, ending at `attemptId`, whose trajectory judgement alarmed. */
function trajectoryStreak(view: PursuitView, attemptId: string): number {
	const trajectoryIds = new Set(
		findQuestionSet(view.input.conditions.questionSet)
			.questions.filter((q) => q.role.kind === "trajectory")
			.map((q) => q.id),
	);
	const attempt = view.attempts.find((a) => a.id === attemptId);
	if (!attempt) return 0;
	const settled = view.attempts.filter(
		(a) => a.hypothesisId === attempt.hypothesisId && a.state === "settled",
	);
	let streak = 0;
	for (const a of [...settled].reverse()) {
		const alarmed = view.judgements.some(
			(j) =>
				j.attemptId === a.id &&
				trajectoryIds.has(j.questionId) &&
				j.fired &&
				j.usable,
		);
		if (!alarmed) break;
		streak++;
	}
	return streak;
}

/** Step-back causes that mean the workspace may be damaged, not merely unfinished. */
const damageSignals = new Set(["protected_touch", "scope_growth", "revisits"]);
function damaging(basis: JsonObject | undefined): boolean {
	if (!basis) return false;
	if (basis.stage === "pre") return true;
	const signals = Array.isArray(basis.signals) ? basis.signals : [];
	return signals.some((s) => typeof s === "string" && damageSignals.has(s));
}

const budgetReasons = {
	attempts: "追求全体の試行予算を使い切りました",
	wall_time: "追求全体の時間予算を使い切りました",
	transitions: "追求全体の手順数の上限に達しました",
} as const;

const noChanges = { filesTouched: [], linesChanged: 0, protectedTouched: [] };

/** Verification must cover exactly the frozen criteria, once each, in any order. */
function acceptancePassed(
	view: PursuitView,
	criteria: readonly CriterionResult[],
): boolean {
	const expected = new Set(view.acceptance.map((c) => c.id));
	return (
		expected.size > 0 &&
		criteria.length === expected.size &&
		new Set(criteria.map((c) => c.id)).size === expected.size &&
		criteria.every((c) => expected.has(c.id) && c.passed)
	);
}

const reviewKinds: Readonly<Record<Review["decision"], DecisionKind>> = {
	continue_strategy: "change_hypothesis",
	change_strategy: "revise_strategy",
	consult: "consult",
	stop: "stop",
};

class WallTimeExpired extends Error {}

export function createPursuitEngine(deps: EngineDeps): PursuitEngine {
	const { store, clock, ids } = deps;
	const warn = (code: string, detail: JsonObject) =>
		deps.onWarning?.(code, detail);

	async function read(id: string): Promise<PursuitView> {
		const view = await store.readSnapshot((db) => ledger.loadPursuit(db, id));
		if (!view) throw new Error(`pursuit_not_found:${id}`);
		return view;
	}

	function result(
		view: PursuitView,
		revision: number,
		status: PursuitStatus,
		event: StepEvent,
	): StepResult {
		return {
			pursuitId: view.id,
			status,
			revision,
			event,
			done: terminalStatuses.includes(status),
		};
	}

	function inference(
		db: LedgerDb,
		view: PursuitView,
		rows: readonly InferenceRow[],
	) {
		for (const row of rows)
			ledger.insertInference(db, {
				id: ids.next("inf"),
				pursuitId: view.id,
				row,
				now: clock.now(),
			});
	}

	const llmRow = <T>(purpose: string, r: LlmResult<T>): InferenceRow => ({
		purpose,
		model: r.model,
		inputTokens: r.inputTokens,
		outputTokens: r.outputTokens,
		cacheReadTokens: r.cacheReadTokens,
		latencyMs: r.latencyMs,
	});

	async function call<T>(
		port: LlmPort,
		request: LlmRequest<T>,
		signal: AbortSignal,
		view: PursuitView,
	): Promise<LlmResult<T>> {
		checkTime(view, signal);
		const r = await port.complete(request, signal);
		checkTime(view, signal);
		return r;
	}
	function checkTime(view: PursuitView, signal: AbortSignal) {
		if (remainingWallMs(view, clock.now()) <= 0) throw new WallTimeExpired();
		signal.throwIfAborted();
	}

	async function askJudge(
		view: PursuitView,
		stage: Stage,
		state: JsonObject,
		attemptId: string | null,
		signal: AbortSignal,
	): Promise<{
		rows: JudgementRow[];
		effects: JudgeEffects;
		usage: InferenceRow;
	} | null> {
		checkTime(view, signal);
		const conditions = view.input.conditions;
		if (!conditions.judge || !deps.judge) return null;
		const set = findQuestionSet(conditions.questionSet);
		const questions = stageQuestions(set, stage, conditions.language);
		if (Object.keys(questions).length > deps.judge.maxQuestions)
			throw new Error("judge_stage_too_many_questions");
		try {
			const response = await deps.judge.ask(
				{
					state,
					questions,
					questionSet: conditions.questionSet,
					adapter: conditions.adapter,
				},
				signal,
			);
			checkTime(view, signal);
			const { rows, effects } = interpret({
				set,
				stage,
				response,
				attemptId,
				policy: view.input.policy,
			});
			return {
				rows,
				effects,
				usage: {
					purpose: `judge:${stage}`,
					model: response.model,
					inputTokens: response.inputTokens,
					outputTokens: 0,
					cacheReadTokens: 0,
					latencyMs: response.latencyMs,
				},
			};
		} catch (error) {
			if (signal.aborted || error instanceof WallTimeExpired) throw error;
			const code =
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "error";
			warn("judge_failed", {
				stage,
				error: error instanceof Error ? error.message : String(error),
			});
			// Fail-open for the loop, but never silent: the ledger shows the judge was absent.
			await store.write((db) =>
				inference(db, view, [
					{
						purpose: `judge:${stage}:failed:${code}`,
						model: "unavailable",
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						latencyMs: 0,
					},
				]),
			);
			return null;
		}
	}

	/**
	 * Keep findings apart from hypotheses (spec/findings-design.md). Duplicates of an
	 * active finding are skipped; nothing is recorded when the condition is off.
	 */
	function recordFindings(
		db: LedgerDb,
		view: PursuitView,
		items: readonly {
			kind: "lemma" | "counterexample" | "observation" | "dead_end";
			statement: string;
			assurance: "exact" | "numeric" | "model" | "unverified";
			scope: "pursuit" | "strategy" | "hypothesis";
		}[],
		source: string | null,
		sourceVerificationId: string | null = null,
	) {
		if (view.input.conditions.findings === "off") return;
		const seen = new Set(
			ledger
				.loadFindings(db, view.id)
				.filter((f) => f.status === "active")
				.map(ledger.findingEvidenceKey),
		);
		for (const item of items) {
			if (!item.statement.trim()) continue;
			const finding = {
				...item,
				sourceAttemptId: source,
				sourceVerificationId,
				strategyId: item.scope === "pursuit" ? null : view.currentStrategyId,
				hypothesisId:
					item.scope === "hypothesis" ? view.currentHypothesisId : null,
			};
			const key = ledger.findingEvidenceKey(finding);
			if (seen.has(key)) continue;
			seen.add(key);
			ledger.insertFinding(db, {
				...finding,
				id: ids.next("fnd"),
				pursuitId: view.id,
				now: clock.now(),
			});
		}
	}

	/** The host's own record of a closed path: a fact, so exact (spec/findings-design.md). */
	function recordDeadEnd(
		db: LedgerDb,
		view: PursuitView,
		hypothesis: string,
		why: string,
	) {
		recordFindings(
			db,
			view,
			[
				{
					kind: "dead_end",
					statement: `仮説「${hypothesis.slice(0, 200)}」は進まなかった: ${why.slice(0, 300)}`,
					assurance: "exact",
					scope: "strategy",
				},
			],
			null,
		);
	}

	/** Findings a check established on its own (e.g. graded lemmas): true regardless of the hypothesis. */
	function checkedFindings(criteria: readonly CriterionResult[]) {
		return criteria.flatMap((c) =>
			(c.findings ?? []).map((f) => ({ ...f, scope: "pursuit" as const })),
		);
	}

	function writeJudgements(
		db: LedgerDb,
		view: PursuitView,
		judged: { rows: JudgementRow[]; usage: InferenceRow } | null,
	) {
		if (!judged) return;
		ledger.insertJudgements(db, {
			ids: judged.rows.map(() => ids.next("jdg")),
			pursuitId: view.id,
			rows: judged.rows,
			now: clock.now(),
		});
		inference(db, view, [judged.usage]);
	}

	function changingTools(tools: readonly ToolDescriptor[]) {
		return new Set(
			tools.filter((t) => t.sideEffect === "workspace").map((t) => t.name),
		);
	}

	function firedSignals(
		view: PursuitView,
		tools: readonly ToolDescriptor[],
	): Signal[] {
		if (!view.input.conditions.rules || !view.currentHypothesisId) return [];
		return signals(
			view,
			view.currentHypothesisId,
			view.input.policy,
			changingTools(tools),
		);
	}

	async function finish(
		view: PursuitView,
		runtime: PursuitRuntime,
		outcome: Report["outcome"],
		reason: string,
		decidedBy: DecidedBy,
		signal: AbortSignal,
		known?: readonly CriterionResult[],
	): Promise<StepResult> {
		const deferred = outcome !== "completed";
		if (!deferred) checkTime(view, signal);
		const criteria = deferred
			? []
			: (known ?? (await runtime.acceptance.verify(signal)));
		if (!deferred) checkTime(view, signal);
		const verified = acceptancePassed(view, criteria);
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
				basis: { verified },
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
		let onAbort = () => {};
		try {
			signal.throwIfAborted();
			const aborted = new Promise<never>((_, reject) => {
				onAbort = () => reject(signal.reason);
				signal.addEventListener("abort", onAbort, { once: true });
			});
			const finalCriteria =
				known ??
				(await Promise.race([runtime.acceptance.verify(signal), aborted]));
			signal.throwIfAborted();
			finalReport = {
				...report,
				criteria: finalCriteria,
				verified: acceptancePassed(view, finalCriteria),
			};
		} catch {
			const issue = signal.aborted ? "aborted" : "failed";
			finalReport = { ...report, verificationIssue: issue };
			warn("final_verification_unavailable", { pursuitId: view.id, issue });
		} finally {
			signal.removeEventListener("abort", onAbort);
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
				basis: { missing },
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

	async function reject(
		view: PursuitView,
		attempt: {
			tool: string;
			input: JsonObject;
			prediction: Prediction;
			whatChanged: string;
			fingerprint: string;
		},
		rejections: readonly Rejection[],
		extra: (db: LedgerDb, attemptId: string) => void,
	): Promise<number> {
		const attemptId = ids.next("att");
		return store.write((db) => {
			ledger.insertAttempt(db, {
				id: attemptId,
				pursuitId: view.id,
				hypothesisId: view.currentHypothesisId!,
				state: "rejected",
				...attempt,
				rejection: rejections,
				now: clock.now(),
			});
			extra(db, attemptId);
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
			});
		});
	}

	async function propose(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult> {
		const conditions = view.input.conditions;
		const policy = view.input.policy;
		const hypothesis = view.hypotheses.find(
			(h) => h.id === view.currentHypothesisId,
		);
		if (!hypothesis) throw new Error("pursuit_without_hypothesis");
		const own = attemptsOf(view, hypothesis.id);
		const spent =
			conditions.rules && own.filter(executed).length >= hypothesis.budget;
		// Under claim, a last attempt that went as predicted gets one chance to claim (spec/verification-design.md §1).
		const claimChance =
			spent &&
			conditions.verifyOn === "claim" &&
			own.at(-1)?.state === "settled" &&
			own.at(-1)?.outcome === "success";
		if (spent && !claimChance)
			return stepBack(view, "仮説の試行予算を使い切りました", "rules", {
				rule: "hypothesis_budget",
			});
		if (rejectionsInRow(view, hypothesis.id) >= policy.budget.rejectionsInRow)
			return stepBack(view, "提案の拒否が続いています", "rules", {
				rule: "rejections_in_row",
			});
		const tools = runtime.tools.list();
		let r: LlmResult<Proposal>;
		try {
			r = await call(
				deps.generator,
				proposalRequest({ view, tools, feedback: null }),
				signal,
				view,
			);
		} catch (error) {
			if (!(error instanceof LlmOutputError)) throw error;
			const revision = await reject(
				view,
				{
					tool: "(invalid)",
					input: {},
					prediction: { expectedStatus: "ok", expectedObservation: "" },
					whatChanged: "",
					fingerprint: "invalid",
				},
				[{ rule: "invalid_proposal", detail: error.reasonCode }],
				() => {},
			);
			return result(view, revision, view.status, "rejected");
		}
		const p = r.value;
		const usage = llmRow("propose", r);
		const gated =
			conditions.rules &&
			conditions.completionCheck === "acceptance" &&
			(p.kind === "step_back" || p.kind === "give_up");
		// A gated step back goes through the completion check below instead.
		if (claimChance && p.kind !== "done" && !gated) {
			await store.write((db) => inference(db, view, [usage]));
			return stepBack(
				await read(view.id),
				"仮説の試行予算を使い切りました",
				"rules",
				{ rule: "hypothesis_budget" },
			);
		}
		if (
			conditions.findings !== "off" &&
			(p.findings?.length || p.refute?.length)
		) {
			const lastSettled = [...view.attempts]
				.reverse()
				.find((a) => a.state === "settled");
			await store.write((db) => {
				recordFindings(
					db,
					view,
					(p.findings ?? []).map((f) => ({
						...f,
						assurance: "unverified" as const,
					})),
					lastSettled?.id ?? null,
				);
				for (const refute of p.refute ?? []) {
					const seq = Number(/^F?(\d+)$/i.exec(refute.id.trim())?.[1]);
					const target = view.findings.find((f) => f.seq === seq);
					// Checked findings cannot be refuted by a claim alone.
					if (target && target.assurance === "unverified")
						ledger.closeFinding(db, {
							id: target.id,
							pursuitId: view.id,
							status: "refuted",
							reason: refute.reason,
							now: clock.now(),
						});
				}
			});
			view = await read(view.id);
		}
		const strategy = view.strategies.find(
			(s) => s.id === view.currentStrategyId,
		);
		const inStrategy = view.hypotheses.filter(
			(h) => h.strategyId === strategy?.id,
		).length;
		const refuse = async (rule: string, detail: string) => {
			const revision = await reject(
				view,
				{
					tool: p.kind,
					input: {},
					prediction: { expectedStatus: "ok", expectedObservation: p.message },
					whatChanged: "",
					fingerprint: p.kind,
				},
				[{ rule, detail }],
				(db) => inference(db, view, [usage]),
			);
			return result(view, revision, view.status, "rejected");
		};
		if (
			conditions.selfCheck === "parts" &&
			(p.kind === "step_back" || p.kind === "give_up") &&
			strategy?.status === "active" &&
			strategy.parts.length
		) {
			const assessment = (p.assessment ?? []).filter(
				(a) => a.part <= strategy.parts.length,
			);
			if (!assessment.length && conditions.rules)
				return refuse(
					"assessment_missing",
					"方針の部品ごとの自己評価（assessment）を書いてください",
				);
			if (assessment.length) {
				await store.write((db) =>
					ledger.setStrategyAssessment(db, { id: strategy.id, assessment }),
				);
				view = await read(view.id);
			}
		}
		// Re-read and judge each criterion before leaving (spec/completion-design.md).
		if (gated) {
			const tools = runtime.tools.list();
			const readers = tools
				.filter((t) => t.readsBack && t.sideEffect === "none")
				.map((t) => t.name);
			const writers = changingTools(tools);
			const settled = view.attempts
				.filter((a) => a.state === "settled")
				.reverse();
			const lastWrite = settled.find((a) => writers.has(a.tool));
			const lastRead = settled.find(
				(a) => readers.includes(a.tool) && a.observation?.status === "ok",
			);
			if (
				readers.length &&
				lastWrite &&
				(!lastRead || lastRead.seq < lastWrite.seq)
			)
				return refuse(
					"reread_required",
					`判断の前に ${readers.join(" / ")} で今の成果物を全文読み直してください`,
				);
			const norm = (id: string) => id.trim().toLowerCase();
			// Any entry saying "not met" wins over a duplicate saying "met".
			const checked = new Map<string, boolean>();
			for (const c of p.acceptanceCheck ?? [])
				checked.set(norm(c.id), (checked.get(norm(c.id)) ?? true) && c.met);
			const missing = view.acceptance.filter((a) => !checked.has(norm(a.id)));
			if (missing.length)
				return refuse(
					"acceptance_check_missing",
					`受入条件ごとの判断（acceptanceCheck）が足りません: ${missing.map((a) => a.id).join(", ")}`,
				);
			// After a refused claim on this deliverable, nudging to claim again only spins.
			const refusedClaim = view.attempts.some(
				(a) =>
					a.fingerprint === "claim" &&
					a.state === "rejected" &&
					(!lastWrite || a.seq > lastWrite.seq),
			);
			if (
				lastWrite &&
				!refusedClaim &&
				view.acceptance.every((a) => checked.get(norm(a.id)))
			)
				return refuse(
					"claim_suggested",
					"すべての受入条件を満たしていると判断しています。step_back ではなく done を申告してください",
				);
		}
		switch (p.kind) {
			case "done": {
				if (!conditions.rules) {
					await store.write((db) => inference(db, view, [usage]));
					return finish(
						await read(view.id),
						runtime,
						"completed",
						p.message || "完了の申告",
						"generator",
						signal,
					);
				}
				checkTime(view, signal);
				const criteria = await runtime.acceptance.verify(signal);
				checkTime(view, signal);
				const passed = acceptancePassed(view, criteria);
				const verificationId = ids.next("ver");
				await store.write((db) => {
					ledger.insertVerification(db, {
						id: verificationId,
						pursuitId: view.id,
						row: { attemptId: null, trigger: "claim", passed, criteria },
						now: clock.now(),
					});
					inference(db, view, [usage]);
					recordFindings(
						db,
						view,
						checkedFindings(criteria),
						null,
						verificationId,
					);
				});
				if (passed)
					return finish(
						await read(view.id),
						runtime,
						"completed",
						p.message || "照合を通過",
						"rules",
						signal,
						criteria,
					);
				const revision = await reject(
					await read(view.id),
					{
						tool: "done",
						input: {},
						prediction: {
							expectedStatus: "ok",
							expectedObservation: p.message,
						},
						whatChanged: "",
						fingerprint: "claim",
					},
					[
						{
							rule: "claim_not_verified",
							detail:
								criteria
									.filter((c) => !c.passed)
									.map((c) => `[${c.id}] ${c.evidence}`)
									.join(" / ") ||
								"照合結果には、すべての受入条件のIDを過不足なく一度ずつ含めてください",
						},
					],
					() => {},
				);
				return result(view, revision, view.status, "rejected");
			}
			case "give_up": {
				const current = view.strategies.find(
					(s) => s.id === view.currentStrategyId,
				);
				if (conditions.rules && conditions.selfCheck === "parts" && current) {
					const unfinished = unfinishedParts(current);
					if (
						unfinished.length &&
						inStrategy < policy.budget.hypothesesPerStrategy
					)
						return refuse(
							"strategy_not_exhausted",
							`まだやりきっていない部品があります: ${describeUnfinished(unfinished)}`,
						);
					if (view.strategies.length < policy.budget.strategies) {
						await store.write((db) => inference(db, view, [usage]));
						return stepBack(
							await read(view.id),
							`断念の前に別の方針を検討する: ${p.message}`,
							"rules",
							{ rule: "give_up_with_strategies_left" },
						);
					}
				}
				await store.write((db) => inference(db, view, [usage]));
				return finish(
					await read(view.id),
					runtime,
					"incomplete",
					p.message || "達成できないと判断",
					"generator",
					signal,
				);
			}
			case "consult":
				if (
					conditions.rules &&
					policy.consultation.requireProgress &&
					consultedWithoutProgress(view)
				)
					return refuse(
						"consult_without_progress",
						"前の相談への答えのあと、まだ何も試していません。答えを踏まえて試してください",
					);
				return consult(
					view,
					p.message || "判断に必要な情報を教えてください",
					p.missing,
					"generator",
					(db) => inference(db, view, [usage]),
				);
			case "step_back":
				await store.write((db) => inference(db, view, [usage]));
				return stepBack(
					await read(view.id),
					p.message || "生成層が振り返りを求めた",
					"generator",
					{},
				);
			case "tool":
				return attempt(view, runtime, p, usage, tools, signal);
		}
	}

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
				return stepBack(await read(view.id), pre.effects.stepBack, "judge", {
					stage: "pre",
				});
			return result(view, revision, view.status, "rejected");
		}
		checkTime(view, signal);
		const attemptId = ids.next("att");
		await store.write((db) => {
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
			return ledger.advancePursuit(db, {
				id: view.id,
				expectedRevision: view.revision,
				now: clock.now(),
			});
		});
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
		const changes =
			runtime.workspace && hypothesis.checkpoint
				? await runtime.workspace.changesSince(hypothesis.checkpoint)
				: noChanges;
		const features: AttemptFeatures = {
			...changes,
			match: null,
			progress: null,
		};
		const awaitDigest = runtime.workspace
			? await runtime.workspace.digest()
			: null;
		const current = await read(view.id);
		await store.write((db) => {
			ledger.settleAttempt(db, {
				id: attemptId,
				observation: {
					status: outcome.status,
					output: outcome.output,
					errorCode: outcome.errorCode ?? null,
				},
				outcome: attemptOutcome(prediction, outcome.status, null, policy),
				refs: outcome.refs,
				features,
				settlement: {
					stage: "need_post_judge",
					digest: awaitDigest,
					effects: null,
				},
				now: clock.now(),
			});
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
		return resumeSettlement(await read(view.id), runtime, attemptId, signal);
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
			const changes =
				runtime.workspace && hyp?.checkpoint
					? await runtime.workspace.changesSince(hyp.checkpoint)
					: noChanges;
			pending = { stage: "need_post_judge", digest, effects: null };
			await store.write((db) => {
				ledger.updateSettlement(db, attemptId, pending);
				ledger.updateAttemptFeatures(db, {
					id: attemptId,
					features: { ...changes, match: null, progress: null },
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
							passed: acceptancePassed(current, criteria),
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
			return finish(
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
			return stepBack(
				current,
				`兆候を検出: ${fired.map((s) => `${s.code}=${s.value}`).join(", ")}`,
				"rules",
				{ signals: fired.map((s) => s.code) },
			);
		const persistent =
			trajectoryStreak(current, attemptId) >= policy.judge.trajectoryPersist;
		if (pending.effects?.consult && persistent)
			return consult(
				current,
				"目標の達成に必要な情報・権限・前提が欠けているようです。補える情報はありますか？",
				pending.effects.consult,
				"judge",
			);
		if (pending.effects?.stepBack && persistent)
			return stepBack(current, pending.effects.stepBack, "judge", {
				stage: "post",
			});
		await store.write((db) =>
			ledger.updateSettlement(db, attemptId, { ...pending, stage: "done" }),
		);
		return result(current, current.revision, current.status, "executed");
	}

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
				reviewRequest({ view, reason, signals: fired.map((s) => s.code) }),
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
			attemptsOf(view, hypothesis.id).filter(executed).length <
				hypothesis.budget;
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
		if (
			conditions.rules &&
			runtime.workspace &&
			hypothesis?.checkpoint &&
			kind !== "continue" &&
			kind !== "change_tool" &&
			(policy.restore === "always" || damaging(lastStepBack?.basis))
		)
			await runtime.workspace.restore(hypothesis.checkpoint);
		const basis: JsonObject = {
			review: reviewed
				? {
						decision: reviewed.decision,
						brokenAssumption: reviewed.brokenAssumption,
					}
				: null,
			judge: fromJudge,
			signals: fired.map((s) => s.code),
			escalation,
			direction,
		};
		if (kind === "stop") {
			await store.write((db) => {
				inference(db, view, usage);
				writeJudgements(db, view, judged);
			});
			return finish(
				await read(view.id),
				runtime,
				"stopped",
				why,
				decidedBy,
				signal,
			);
		}
		if (kind === "consult")
			return consult(
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
							result: `相談: ${why}`,
							now: clock.now(),
						});
						recordDeadEnd(db, view, hypothesis.body, why);
					}
				},
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
					result: why,
					now: clock.now(),
				});
				recordDeadEnd(db, view, hypothesis.body, why);
			}
			if (status === "planning" && strategy?.status === "active") {
				ledger.closeStrategy(db, {
					id: strategy.id,
					reason: why,
					now: clock.now(),
				});
				if (conditions.findings !== "off")
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
					return await resumeSettlement(view, runtime, pending.id, signal);
				const over = pursuitBudgetExceeded(view, clock.now());
				if (over)
					return finish(
						view,
						runtime,
						"stopped",
						budgetReasons[over],
						"rules",
						signal,
					);
				switch (view.status) {
					case "planning":
						return await plan(view, runtime, signal);
					case "hypothesizing":
						return await hypothesize(view, runtime, signal);
					case "proposing":
						return await propose(view, runtime, signal);
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
					return finish(
						await read(pursuitId),
						runtime,
						"stopped",
						budgetReasons.wall_time,
						"rules",
						expired.signal,
					);
				}
				if (!(error instanceof LlmOutputError)) throw error;
				return finish(
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
			return finish(view, runtime, "stopped", reason, "human", signal);
		},

		async view(pursuitId) {
			return store.readSnapshot((db) => ledger.loadPursuit(db, pursuitId));
		},
	};
}
