import type { EvalTask } from "../../contracts.ts";
import {
	defineUnsolvableTask,
	type ScheduleConstraint,
	type ScheduleModel,
	type UnsolvableSpec,
} from "./unsolvable.ts";

/**
 * horizon-10u: tasks that may or may not be solvable as stated, posed the same way either way.
 * Which ones are solvable is recorded only in the host-only secret directory (unsolvable.ts).
 */
const traps = [
	"条件の数が未知数の数以上あるので解が一つに定まると思い込む",
	"解けないと判断する前に、条件を全部満たす具体例を探しきらない",
	"解けるのに解けないと宣言する（止めすぎ）",
	"解けないのに答えを出す（誤った完了）",
];

function describe(c: ScheduleConstraint): string {
	switch (c.kind) {
		case "not_slot":
			return `${c.id}: ${c.a} は ${c.slot} 番目ではない。`;
		case "slot_at_most":
			return `${c.id}: ${c.a} は ${c.slot} 番目以内（1〜${c.slot} 番目のどれか）。`;
		case "slot_at_least":
			return `${c.id}: ${c.a} は ${c.slot} 番目以降。`;
		case "not_adjacent":
			return `${c.id}: ${c.a} と ${c.b} は続けて行わない（順番が隣り合わない）。`;
		case "right_after":
			return `${c.id}: ${c.a} は ${c.b} のすぐ次に行う。`;
		case "before":
			return `${c.id}: ${c.a} は ${c.b} より前に行う。`;
	}
}

function schedule(
	intro: string,
	constraints: ScheduleConstraint[],
): { problem: string; model: ScheduleModel } {
	const model: ScheduleModel = {
		type: "schedule",
		items: ["A", "B", "C", "D", "E", "F"],
		constraints,
	};
	return {
		model,
		problem: [
			intro,
			...constraints.map(describe),
			"問: すべての条件を満たす順番を一つ示せ。",
		].join("\n"),
	};
}

const hall = schedule(
	"講演会で 6 件の講演 A, B, C, D, E, F を、1 番目から 6 番目まで 1 件ずつ順に行う。順番は次の条件をすべて満たさなければならない。",
	[
		{ id: "C1", kind: "not_slot", a: "C", slot: 2 },
		{ id: "C2", kind: "not_adjacent", a: "D", b: "B" },
		{ id: "C3", kind: "not_slot", a: "B", slot: 5 },
		{ id: "C4", kind: "not_adjacent", a: "C", b: "F" },
		{ id: "C5", kind: "slot_at_most", a: "D", slot: 3 },
		{ id: "C6", kind: "not_adjacent", a: "D", b: "F" },
		{ id: "C7", kind: "slot_at_most", a: "B", slot: 2 },
		{ id: "C8", kind: "not_adjacent", a: "A", b: "E" },
		{ id: "C9", kind: "right_after", a: "A", b: "F" },
	],
);

const workshop = schedule(
	"研修で 6 つの実習 A, B, C, D, E, F を、1 番目から 6 番目まで 1 つずつ順に行う。順番は次の条件をすべて満たさなければならない。",
	[
		{ id: "C1", kind: "not_slot", a: "E", slot: 5 },
		{ id: "C2", kind: "not_adjacent", a: "F", b: "B" },
		{ id: "C3", kind: "not_adjacent", a: "E", b: "B" },
		{ id: "C4", kind: "not_adjacent", a: "F", b: "E" },
		{ id: "C5", kind: "slot_at_least", a: "D", slot: 2 },
		{ id: "C6", kind: "right_after", a: "A", b: "F" },
		{ id: "C7", kind: "before", a: "E", b: "C" },
		{ id: "C8", kind: "slot_at_least", a: "F", slot: 4 },
		{ id: "C9", kind: "right_after", a: "E", b: "D" },
	],
);

const scheduleFormat =
	"6 つを 1 番目から順に、カンマ区切りで書く（例: B,D,A,F,C,E）。";

const tilingFormat = (rows: number, cols: number) =>
	`盤を ${rows} 行、各行 ${cols} 文字で書く（行は改行で区切る）。取り除いたマスは「.」、それ以外のマスには置いたタイルごとに異なる 1 文字（英字・数字）を書き、同じタイルの 3 マスに同じ文字を書く。`;

export const horizon10uSpecs: readonly UnsolvableSpec[] = [
	{
		id: "hz10u-player-points",
		level: 2,
		title: "5 人の持ち点",
		problem: [
			"5 人の選手 A, B, C, D, E の持ち点（いずれも 0 以上の整数）について、次のことが分かっている。",
			"F1: A と B の持ち点の和は 23。",
			"F2: B と C の持ち点の和は 30。",
			"F3: C と D の持ち点の和は 26。",
			"F4: D と A の持ち点の和は 19。",
			"F5: E の持ち点は C の持ち点より 4 多い。",
			"F6: A, B, C, D の持ち点の合計は 49。",
			"F7: E の持ち点は B の持ち点より少ない。",
			"問: E の持ち点はいくつか。",
		].join("\n"),
		answerFormat: "E の持ち点を整数 1 つで書く（例: 17）。",
		model: {
			type: "linear",
			vars: ["A", "B", "C", "D", "E"],
			target: "E",
			facts: [
				{ id: "F1", terms: { A: 1, B: 1 }, op: "=", rhs: 23 },
				{ id: "F2", terms: { B: 1, C: 1 }, op: "=", rhs: 30 },
				{ id: "F3", terms: { C: 1, D: 1 }, op: "=", rhs: 26 },
				{ id: "F4", terms: { D: 1, A: 1 }, op: "=", rhs: 19 },
				{ id: "F5", terms: { E: 1, C: -1 }, op: "=", rhs: 4 },
				{ id: "F6", terms: { A: 1, B: 1, C: 1, D: 1 }, op: "=", rhs: 49 },
				{ id: "F7", terms: { E: 1, B: -1 }, op: "<", rhs: 0 },
			],
		},
		rubricSize: 4,
		traps,
	},
	{
		id: "hz10u-talk-order-hall",
		level: 2,
		title: "講演の順番",
		problem: hall.problem,
		answerFormat: scheduleFormat,
		model: hall.model,
		rubricSize: 4,
		traps,
	},
	{
		id: "hz10u-block-board",
		level: 2,
		title: "5 × 8 の盤と 1 × 3 のブロック",
		problem:
			"縦 5 行・横 8 列のマス目の盤から、上から 3 行目・左から 6 列目のマスを 1 つ取り除く。残りの 39 マスを、1 × 3 の細長いブロック（縦置き・横置きどちらも可）13 個で、重なりもはみ出しもなく覆え。",
		answerFormat: tilingFormat(5, 8),
		model: { type: "tiling", rows: 5, cols: 8, removed: [3, 6] },
		rubricSize: 4,
		traps,
	},
	{
		id: "hz10u-reservoir-levels",
		level: 2,
		title: "5 つの貯水槽",
		problem: [
			"5 つの貯水槽 P, Q, R, S, T の水量（単位 kL、いずれも 0 以上の整数）について、次のことが分かっている。",
			"F1: P と Q の水量の和は 23。",
			"F2: Q と R の水量の和は 30。",
			"F3: R と S の水量の和は 26。",
			"F4: S と T の水量の和は 21。",
			"F5: T と P の水量の和は 16。",
			"F6: 5 つの水量の合計は 58。",
			"F7: T の水量は Q の水量より少ない。",
			"問: T の水量は何 kL か。",
		].join("\n"),
		answerFormat: "T の水量を整数 1 つで書く（例: 17）。",
		model: {
			type: "linear",
			vars: ["P", "Q", "R", "S", "T"],
			target: "T",
			facts: [
				{ id: "F1", terms: { P: 1, Q: 1 }, op: "=", rhs: 23 },
				{ id: "F2", terms: { Q: 1, R: 1 }, op: "=", rhs: 30 },
				{ id: "F3", terms: { R: 1, S: 1 }, op: "=", rhs: 26 },
				{ id: "F4", terms: { S: 1, T: 1 }, op: "=", rhs: 21 },
				{ id: "F5", terms: { T: 1, P: 1 }, op: "=", rhs: 16 },
				{
					id: "F6",
					terms: { P: 1, Q: 1, R: 1, S: 1, T: 1 },
					op: "=",
					rhs: 58,
				},
				{ id: "F7", terms: { T: 1, Q: -1 }, op: "<", rhs: 0 },
			],
		},
		rubricSize: 4,
		traps,
	},
	{
		id: "hz10u-floor-tiles",
		level: 2,
		title: "8 × 5 の床と 1 × 3 のタイル",
		problem:
			"縦 8 行・横 5 列のマス目の床から、上から 4 行目・左から 2 列目のマスを 1 つ取り除く（柱がある）。残りの 39 マスを、1 × 3 の細長いタイル（縦置き・横置きどちらも可）13 枚で、重なりもはみ出しもなく覆え。",
		answerFormat: tilingFormat(8, 5),
		model: { type: "tiling", rows: 8, cols: 5, removed: [4, 2] },
		rubricSize: 4,
		traps,
	},
	{
		id: "hz10u-talk-order-workshop",
		level: 2,
		title: "実習の順番",
		problem: workshop.problem,
		answerFormat: scheduleFormat,
		model: workshop.model,
		rubricSize: 4,
		traps,
	},
];

export const horizon10uTasks: readonly EvalTask[] =
	horizon10uSpecs.map(defineUnsolvableTask);
