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
	Object.assign(ctx, makeTransitions(ctx), {
		propose,
		attempt,
		resumeSettlement,
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
			conditions.rules &&
			budgetCounted(view, own, runtime.tools.list()).length >=
				hypothesis.budget;
		// Under claim, a last attempt that went as predicted gets one chance to claim (spec/verification-design.md §1).
		const claimChance =
			spent &&
			conditions.verifyOn === "claim" &&
			own.at(-1)?.state === "settled" &&
			own.at(-1)?.outcome === "success";
		if (spent && !claimChance)
			return ctx.stepBack(view, "仮説の試行予算を使い切りました", "rules", {
				rule: "hypothesis_budget",
			});
		if (rejectionsInRow(view, hypothesis.id) >= policy.budget.rejectionsInRow)
			return ctx.stepBack(view, "提案の拒否が続いています", "rules", {
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
			return ctx.stepBack(
				await read(view.id),
				"仮説の試行予算を使い切りました",
				"rules",
				{ rule: "hypothesis_budget" },
			);
		}
		const findingsBefore = new Set(view.findings.map((f) => f.id));
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
				// What replaced a refuted finding: the findings recorded in the same move (fixes f §C).
				const added = ledger
					.loadFindings(db, view.id)
					.filter((f) => !findingsBefore.has(f.id) && f.kind !== "dead_end")
					.map((f) => `F${f.seq}`);
				for (const refute of p.refute ?? []) {
					const seq = Number(/^F?(\d+)$/i.exec(refute.id.trim())?.[1]);
					const target = view.findings.find((f) => f.seq === seq);
					// Checked findings cannot be refuted by a claim alone.
					if (target && target.assurance === "unverified")
						ledger.closeFinding(db, {
							id: target.id,
							pursuitId: view.id,
							status: "refuted",
							reason:
								(added.length
									? `${refute.reason}［同じ一手で記録: ${added.join(", ")}］`
									: refute.reason) +
								citationNote(
									refute.reason,
									target.seq,
									ledger.loadFindings(db, view.id),
								),
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
		// Findings of a proposal are recorded before its move is checked: they are observations,
		// valid whatever move is chosen. A rejection says so (spec/fixes-2026-10-22-c.md §5).
		const kept = view.findings.filter((f) => !findingsBefore.has(f.id));
		const keptNote = kept.length
			? `（この提案の findings は台帳に記録済み: ${kept.map((f) => `F${f.seq}`).join(", ")}。退けたのは選んだ手だけなので、記録し直さず番号で引用してください）`
			: "";
		const refuse = async (rule: string, detail: string) => {
			detail = `${detail}${keptNote}`;
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
		// A citation of a finding the ledger does not hold (spec/fixes-2026-10-22.md §e).
		if (conditions.rules && conditions.findings !== "off") {
			const unrecorded = unrecordedFindingRefs(view, p);
			if (unrecorded.length)
				return refuse(
					"finding_not_recorded",
					`台帳にない知見を引用しています: ${unrecorded.join(", ")}（台帳の知見は ${view.findings.length} 件）。確かめた事実は findings に記録してから、その F番号で引用してください`,
				);
		}
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
					return ctx.finish(
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
				const passed = acceptancePassed(view.acceptance, criteria);
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
					return ctx.finish(
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
						return ctx.stepBack(
							await read(view.id),
							`断念の前に別の方針を検討する: ${p.message}`,
							"rules",
							{ rule: "give_up_with_strategies_left" },
						);
					}
				}
				await store.write((db) => inference(db, view, [usage]));
				return ctx.finish(
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
				return ctx.consult(
					view,
					p.message || "判断に必要な情報を教えてください",
					p.missing,
					"generator",
					(db) => inference(db, view, [usage]),
				);
			case "step_back":
				await store.write((db) => inference(db, view, [usage]));
				return ctx.stepBack(
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
		const features = await featuresOf(view, runtime, hypothesis.checkpoint, {
			tool: tool.name,
			input,
		});
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
					...(outcome.unclipped?.length
						? { unclipped: outcome.unclipped }
						: {}),
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
					return await resumeSettlement(view, runtime, pending.id, signal);
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
