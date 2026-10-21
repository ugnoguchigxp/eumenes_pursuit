import type { EvalTask } from "../../contracts.ts";
import { defineVerdictTask } from "./verdict.ts";

/**
 * horizon-8: hidden-truth statements. Each claim is phrased the same way whether it is true or
 * not; which ones are true is recorded only in the host-only secret directory (verdict.ts).
 */
const traps = [
	"小さい場合の確認だけで判定する",
	"判定と提出物（証明・反例）が食い違う",
];

export const horizon8Tasks: readonly EvalTask[] = [
	defineVerdictTask({
		id: "hz8-gcd-quintic-shift",
		level: 4,
		title: "隣り合う 5 乗足す 2 の最大公約数",
		claim:
			"すべての正の整数 n について、n^5 + 2 と (n + 1)^5 + 2 は互いに素である。",
		counterexample: {
			format: { type: "integer" },
			how: "data には n を 10 進の整数で書く（例: 12345）。",
			rule: { name: "gcd-shift", a: 5, b: 2 },
		},
		rubricSize: 4,
		traps,
	}),
	defineVerdictTask({
		id: "hz8-real-tournament-rank",
		level: 4,
		title: "A + Aᵀ = J − I を満たす実行列の階数",
		claim:
			"n ≥ 2 とし、J をすべての成分が 1 の n × n 行列、I を n × n 単位行列とする。A + A^T = J − I を満たすすべての実 n × n 行列 A について、rank A ≥ n − 1 である（A の成分は 0, 1 に限らない任意の実数）。",
		counterexample: {
			format: { type: "rational-matrix", minN: 2, maxN: 30 },
			how: "data には有理数成分の行列 A を 1 行ずつ書く（行は改行で区切り、成分は空白またはカンマで区切る。整数または p/q。2 ≤ n ≤ 30）。",
			rule: { name: "skew-rank", minN: 2, maxN: 30 },
		},
		rubricSize: 4,
		traps,
	}),
	defineVerdictTask({
		id: "hz8-cyclic-three",
		level: 4,
		title: "3 項の分母をもつ巡回和",
		claim:
			"n ≥ 4 を整数とし、正の実数 x_1, …, x_n の添字は n を法として巡回させる（x_{n+1} = x_1, x_{n+2} = x_2, x_{n+3} = x_3）。すべての n ≥ 4 とすべての正の実数 x_1, …, x_n について、Σ_{i=1}^{n} x_i / (x_{i+1} + x_{i+2} + x_{i+3}) ≥ n/3 が成り立つ。",
		counterexample: {
			format: { type: "rationals", minN: 4, maxN: 200 },
			how: "data には x_1, …, x_n を正の有理数（整数または p/q）のカンマ区切りで書く（n はその個数、4 ≤ n ≤ 200。例: 1, 2, 3/2, 5）。",
			rule: {
				name: "cyclic-ratio",
				num: [0],
				den: [
					[1, 1],
					[2, 1],
					[3, 1],
				],
				bound: "1/3",
				minN: 4,
				maxN: 200,
			},
		},
		rubricSize: 4,
		traps,
	}),
	defineVerdictTask({
		id: "hz8-gcd-cauchy-form",
		level: 4,
		title: "gcd(i, j)/(i + j) の二次形式",
		claim:
			"すべての正の整数 n とすべての実数 x_1, …, x_n について、Σ_{i=1}^{n} Σ_{j=1}^{n} gcd(i, j) x_i x_j / (i + j) ≥ 0 が成り立つ。",
		counterexample: {
			format: { type: "rationals", minN: 1, maxN: 200 },
			how: "data には x_1, …, x_n を有理数（整数または p/q、負でもよい）のカンマ区切りで書く（n はその個数、1 ≤ n ≤ 200。例: 1, -2, 3/2）。",
			rule: { name: "gcd-form", minN: 1, maxN: 200 },
		},
		rubricSize: 4,
		traps,
	}),
	defineVerdictTask({
		id: "hz8-tournament-rank-f3",
		level: 4,
		title: "トーナメント行列の 3 元体上の階数",
		claim:
			"成分が 0 または 1 の n × n 行列 A で、対角成分がすべて 0 であり、i ≠ j のとき a_{ij} と a_{ji} のちょうど一方が 1 であるもの（すなわち A + A^T = J − I、J はすべての成分が 1 の行列）をトーナメント行列と呼ぶ。すべての n ≥ 2 とすべての n × n トーナメント行列 A について、3 元体 F_3 上での A の階数は n − 1 以上である。",
		counterexample: {
			format: { type: "binary-matrix", minN: 2, maxN: 40 },
			how: "data には A を 1 行ずつ 0 と 1 の文字列で書く（行は改行で区切る。2 ≤ n ≤ 40。例: 3 × 3 なら 010、001、100 の 3 行）。",
			rule: { name: "tournament-rank", p: 3, minN: 2, maxN: 40 },
		},
		rubricSize: 4,
		traps,
	}),
];
