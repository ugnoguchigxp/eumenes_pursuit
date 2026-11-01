import type {
	CriterionResult,
	JsonObject,
	LedgerDb,
	ToolDescriptor,
} from "../../contracts/index.ts";
import { attemptTally, verdictText } from "../generation/prompts.ts";
import { interpret, type JudgeEffects } from "../judge/interpret.ts";
import {
	findQuestionSet,
	stageQuestions,
	type Stage,
} from "../judge/question-sets.ts";
import * as ledger from "../ledger/index.ts";
import type {
	AttemptFeatures,
	InferenceRow,
	JudgementRow,
	Prediction,
	PursuitView,
	Rejection,
} from "../ledger/types.ts";
import { isScratchPath, signals, type Signal } from "../rules/checks.ts";
import type { EngineBase } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import {
	findingRefs,
	noChanges,
	normalPath,
	sentenceClip,
	WallTimeExpired,
} from "./helpers.ts";

export function makeSupport(base: EngineBase) {
	const { deps, store, clock, ids, warn, inference, checkTime } = base;
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
		const stored = ledger.loadFindings(db, view.id);
		const seen = new Set(
			stored
				.filter((f) => f.status === "active")
				.map(ledger.findingEvidenceKey),
		);
		// F numbers a statement may cite: the ledger's, and those this batch is about to take
		// (spec/fixes-2026-10-22-d.md §3.3). Another one is kept but marked, not rejected.
		const next = Math.max(0, ...stored.map((f) => f.seq)) + 1;
		const known = new Set([
			...stored.map((f) => f.seq),
			...items.map((_, i) => next + i),
		]);
		for (const raw of items) {
			if (!raw.statement.trim()) continue;
			const dangling = findingRefs(raw.statement).filter((n) => !known.has(n));
			const item = dangling.length
				? {
						...raw,
						statement: `${raw.statement}［注: ${dangling.map((n) => `F${n}`).join(", ")} は記録の時点で台帳にない番号］`,
					}
				: raw;
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

	/**
	 * The host's own record of a closed path (spec/findings-design.md). Built from the record only, so
	 * 確定 is warranted: the hypothesis, its tally, the last executed attempt's verdict, and the step
	 * back's reason quoted as the stepper's words (spec/fixes-2026-10-22-f.md §B). A reviewer's
	 * reason is not pasted in: it judges the strategy, not what failed.
	 */
	function recordDeadEnd(
		db: LedgerDb,
		view: PursuitView,
		hypothesisId: string,
	) {
		const h = view.hypotheses.find((x) => x.id === hypothesisId);
		if (!h) return;
		const last = view.attempts
			.filter((a) => a.hypothesisId === h.id && a.state === "settled")
			.at(-1);
		const stepBack = [...view.decisions]
			.reverse()
			.find((d) => d.kind === "step_back");
		const who = stepBack?.decidedBy === "generator" ? "生成側" : "規則・判定";
		const statement = [
			`仮説${h.seq}「${sentenceClip(h.body, 200)}」は成り立たないまま閉じた（${attemptTally(view, h.id)}）。`,
			last
				? `最後に実行した試行: #${last.seq} ${last.tool} → ${verdictText(last, view.input.conditions.verdictLabel)}。`
				: "実行した試行はない。",
			stepBack?.reason
				? `一段上へ戻した理由（${who}の説明。ホストは確かめていない）: ${sentenceClip(stepBack.reason, 200)}`
				: "",
		].join("");
		recordFindings(
			db,
			view,
			[
				{
					kind: "dead_end",
					statement,
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

	/**
	 * Attempt features from the workspace changes, with `generated`: files absent when the pursuit
	 * started (filesCreated against the first hypothesis checkpoint) that no workspace-changing
	 * attempt named as its `path` input. Without filesCreated from the port, nothing is generated.
	 */
	async function featuresOf(
		view: PursuitView,
		runtime: PursuitRuntime,
		checkpoint: string | null,
		current: { tool: string; input: JsonObject } | null,
	): Promise<AttemptFeatures> {
		const changes =
			runtime.workspace && checkpoint
				? await runtime.workspace.changesSince(checkpoint)
				: noChanges;
		const base = {
			filesTouched: changes.filesTouched,
			linesChanged: changes.linesChanged,
			protectedTouched: changes.protectedTouched,
			match: null,
			progress: null,
		};
		const root = [...view.hypotheses]
			.sort((a, b) => a.seq - b.seq)
			.find((h) => h.checkpoint)?.checkpoint;
		if (!runtime.workspace || !root || !changes.filesTouched.length)
			return base;
		const created =
			root === checkpoint
				? changes.filesCreated
				: (await runtime.workspace.changesSince(root)).filesCreated;
		if (!created) return base;
		const writers = changingTools(runtime.tools.list());
		const authored = new Set(
			[
				...view.attempts.map((a) => ({ tool: a.tool, input: a.input })),
				...(current ? [current] : []),
			]
				.filter((a) => writers.has(a.tool) && typeof a.input.path === "string")
				.map((a) => normalPath(a.input.path as string)),
		);
		const fresh = new Set(created);
		return {
			...base,
			generated: changes.filesTouched.filter(
				(f) =>
					fresh.has(f) &&
					!authored.has(f) &&
					!isScratchPath(f, view.input.policy.signals.scratchDirs),
			),
		};
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
	return {
		askJudge,
		recordFindings,
		recordDeadEnd,
		checkedFindings,
		writeJudgements,
		featuresOf,
		changingTools,
		firedSignals,
		reject,
	};
}
