import {
	LlmOutputError,
	type LlmResult,
	type StepResult,
	type JsonValue,
} from "../../contracts/index.ts";
import {
	budgetCounted,
	proposalRequest,
	type Proposal,
} from "../generation/prompts.ts";
import * as ledger from "../ledger/index.ts";
import type { PursuitView } from "../ledger/types.ts";
import { acceptancePassed } from "../rules/acceptance.ts";
import {
	attemptsOf,
	rejectionsInRow,
	unrecordedFindingRefs,
} from "../rules/checks.ts";
import {
	consultedWithoutProgress,
	describeUnfinished,
	unfinishedParts,
} from "../rules/parts.ts";
import type { EngineCtx, EngineSteps } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import { citationNote } from "./helpers.ts";
import { digestJson } from "../rules/fingerprint.ts";

export function makePropose(ctx: EngineCtx): Pick<EngineSteps, "propose"> {
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
		checkTime,
		reject,
		recordFindings,
		checkedFindings,
		changingTools,
	} = ctx;
	async function propose(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult> {
		if (view.actionPlan) {
			const plan = view.actionPlan;
			const tools = runtime.tools.list();
			const digest = runtime.workspace
				? await runtime.workspace.digest()
				: null;
			if (
				plan.hypothesisId !== view.currentHypothesisId ||
				digest !== plan.digest ||
				digestJson(tools as unknown as JsonValue) !== plan.toolsDigest ||
				!plan.actions.length
			) {
				const revision = await store.write((db) => {
					ledger.setActionPlan(db, view.id, null);
					ledger.insertDecision(db, {
						id: ids.next("dec"),
						pursuitId: view.id,
						kind: "continue",
						reason: "未実行の読取り計画を状態変更のため破棄",
						basis: { rule: "plan_invalidated" },
						decidedBy: "rules",
						now: clock.now(),
					});
					return ledger.advancePursuit(db, {
						id: view.id,
						expectedRevision: view.revision,
						now: clock.now(),
					});
				});
				return result(view, revision, view.status, "interrupted");
			}
			checkTime(view, signal);
			return ctx.attempt(
				view,
				runtime,
				{
					kind: "tool",
					...plan.actions[0]!,
					message: "",
					missing: "",
					following: [],
				},
				null,
				tools,
				signal,
			);
		}
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
				return ctx.attempt(view, runtime, p, usage, tools, signal);
		}
	}
	return { propose };
}
