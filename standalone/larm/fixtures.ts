import type { Question } from "../../src/contracts/judge.ts";

/** Japanese question mix used by the smoke run and the live test: 2 noul + 1 choice + 1 score. */
export const smokeQuestions: Record<string, Question> = {
	scope_expanding: {
		type: "noul",
		instructions: "直前の試行より変更したファイル数が増えていれば yes。",
	},
	touches_checks: {
		type: "noul",
		instructions: "受入条件や検査のファイルを変更していれば yes。",
	},
	flow: {
		type: "choice",
		instructions: "試行の流れの状態を選ぶ。",
		criteria: {
			progressing: "失敗が減り、目標に近づいている。",
			stalled: "同じ失敗が続き、進展がない。",
			runaway: "目標と無関係な変更が広がっている。",
		},
	},
	closeness: {
		type: "score",
		instructions: "元の受入条件にどれだけ近づいたかを段階で答える。",
		criteria: [
			"まったく近づいていない",
			"少し近づいた",
			"かなり近づいた",
			"ほぼ満たしている",
		],
	},
};
