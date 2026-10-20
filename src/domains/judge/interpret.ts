import type {
	Answer,
	DecisionKind,
	JudgeResponse,
	Policy,
	VersionRef,
} from "../../contracts/index.ts";
import type { JudgementRow, Rejection } from "../ledger/types.ts";
import type { QuestionSet, Stage } from "./question-sets.ts";

export interface JudgeEffects {
	readonly rejections: readonly Rejection[];
	readonly stepBack: string | null;
	readonly consult: string | null;
	/** D3 normalized 0..1 (expected level / top level). */
	readonly match: number | null;
	/** D5 normalized 0..1. */
	readonly progress: number | null;
	readonly next: DecisionKind | null;
}

const nextKinds: Readonly<Record<string, DecisionKind>> = {
	continue: "continue",
	change_tool: "change_tool",
	change_hypothesis: "change_hypothesis",
	revise_strategy: "revise_strategy",
	consult: "consult",
	stop: "stop",
};

function normalized(answer: Answer): number | null {
	if (answer.type !== "score" || answer.probabilities.length < 2) return null;
	return answer.score / (answer.probabilities.length - 1);
}

/**
 * Turn answers into ledger rows and effects. Discrete effects need confidence at
 * or above the threshold; scores feed features as expectations either way.
 */
export function interpret(input: {
	set: QuestionSet;
	stage: Stage;
	response: JudgeResponse;
	attemptId: string | null;
	policy: Policy;
}): { rows: JudgementRow[]; effects: JudgeEffects } {
	const { policy } = input;
	const th = policy.judge.confidence;
	const rows: JudgementRow[] = [];
	const rejections: Rejection[] = [];
	let stepBack: string | null = null;
	let consult: string | null = null;
	let match: number | null = null;
	let progress: number | null = null;
	let next: DecisionKind | null = null;
	const questionSet: VersionRef = {
		id: input.set.id,
		version: input.set.version,
	};
	for (const definition of input.set.questions) {
		if (definition.stage !== input.stage) continue;
		const answer = input.response.answers[definition.id];
		if (!answer) continue;
		const usable = answer.confidence >= th;
		let fired = false;
		let threshold = th;
		switch (definition.role.kind) {
			case "guard_reject":
			case "guard_step_back":
				threshold = policy.judge.guardYes;
				fired = answer.type === "noul" && answer.pYes >= threshold;
				break;
			case "necessity":
				threshold = 1 - policy.judge.guardYes;
				fired = answer.type === "noul" && answer.pYes <= threshold;
				break;
			case "trajectory":
				fired = answer.type === "choice" && answer.choice !== "progress";
				break;
			case "match":
				threshold = policy.judge.mismatchBelow;
				{
					const value = normalized(answer);
					fired = value !== null && value < threshold;
					// Below the confidence threshold the score informs nothing (plan §8.4).
					match = usable ? value : null;
				}
				break;
			case "progress":
				progress = normalized(answer);
				break;
			case "next_decision":
				fired = true;
				break;
		}
		rows.push({
			attemptId: input.attemptId,
			stage: input.stage,
			questionSet,
			questionId: definition.id,
			answer,
			threshold,
			fired,
			usable,
			model: input.response.model,
			adapter: input.response.adapter,
		});
		if (!fired || !usable) continue;
		const label = `判定器 ${definition.id}`;
		switch (definition.role.kind) {
			case "guard_reject":
				rejections.push({
					rule: `judge_${definition.id}`,
					detail: `${label}: 受入条件や検査に触れる行動と判定されました`,
				});
				stepBack ??= `${label} が受入条件・検査への接触を検出`;
				break;
			case "necessity":
				rejections.push({
					rule: `judge_${definition.id}`,
					detail: `${label}: 現在の仮説の検証に直接必要な行動ではないと判定されました`,
				});
				break;
			case "guard_step_back":
				rejections.push({
					rule: `judge_${definition.id}`,
					detail: `${label}: 変更範囲を広げる行動と判定されました`,
				});
				stepBack ??= `${label} が変更範囲の拡大を検出`;
				break;
			case "trajectory":
				if (answer.type !== "choice") break;
				if (answer.choice === "needs_info")
					consult ??= `${label}: 必要な情報・権限・前提が欠けている`;
				else stepBack ??= `${label}: 流れが ${answer.choice}`;
				break;
			case "next_decision":
				if (answer.type === "choice") next = nextKinds[answer.choice] ?? null;
				break;
			default:
				break;
		}
	}
	return {
		rows,
		effects: { rejections, stepBack, consult, match, progress, next },
	};
}

/** Order of caution. The more cautious of two proposals wins (plan §6, §8.4). */
const caution: readonly DecisionKind[] = [
	"continue",
	"change_tool",
	"change_hypothesis",
	"revise_strategy",
	"consult",
	"stop",
];

export function moreCautious(a: DecisionKind, b: DecisionKind): DecisionKind {
	return caution.indexOf(a) >= caution.indexOf(b) ? a : b;
}
