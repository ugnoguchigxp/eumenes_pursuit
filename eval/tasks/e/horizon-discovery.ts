import type { EvalTask } from "../../contracts.ts";
import { defineDiscoveryTask } from "./discovery.ts";

/**
 * horizon-7: discovery tasks. Each answer was computed by the author (exhaustive search, SAT,
 * CP-SAT, two independent methods) and is stored only outside the repository
 * (`--secret-dir`); see discovery.ts. Statements fix every convention needed for a unique answer.
 */
export const horizon7Tasks: readonly EvalTask[] = [
	defineDiscoveryTask({
		id: "hz7-construct-o1d1-12",
		level: 4,
		title: "縦横に 1 つ・斜めに 1 つの印（12 × 12）",
		kind: "construction",
		board: { rows: 12, cols: 12, rule: "o1d1" },
		statement: `12 × 12 の盤のいくつかのマスに印を付ける。マス A の「縦横の隣」とは A と辺を共有するマス（最大 4 つ）、「斜めの隣」とは A と頂点だけを共有するマス（最大 4 つ）のことである。
条件: 印の付いたどのマスについても、その縦横の隣のうち印の付いたものがちょうど 1 つあり、かつ斜めの隣のうち印の付いたものがちょうど 1 つある。
この条件を満たす印の付け方のうち、印の数が最大になるものを 1 つ求めよ。`,
		traps: [
			"周期的な敷き詰めだけでは端の分が足りない",
			"最大であることの確認をしない",
		],
	}),
	defineDiscoveryTask({
		id: "hz7-count-bracelet-13",
		level: 4,
		title: "13 角形の 3 色塗り分け（回転・裏返しを同一視）",
		kind: "integer",
		statement: `正 13 角形の 13 個の頂点のそれぞれを、赤・青・緑のいずれか 1 色で塗る。条件: 辺で結ばれた 2 頂点は異なる色で塗り、3 色のどれも少なくとも 3 個の頂点に使う。
正 13 角形を回転または裏返し（鏡映）して一致する 2 つの塗り方は同じものとみなす（色の入れ替えは同一視しない）。条件を満たす塗り方は何通りあるか。`,
		traps: ["色の個数の組の数え漏れ", "対称性による割り算の誤り"],
	}),
	defineDiscoveryTask({
		id: "hz7-formula-king2",
		level: 4,
		title: "キングの隣接でちょうど 2 つ（n × n の最大）",
		kind: "formula",
		statement: `n ≥ 1 とし、n × n の盤のいくつかのマスに印を付ける。2 つの異なるマスが「隣接する」とは、辺または頂点を共有する（チェスのキングの 1 手で移れる）ことをいう。
条件: 印の付いたどのマスについても、それに隣接するマスのうち印の付いたものがちょうど 2 つある（印が 1 つもない付け方も条件を満たすとみなす）。
条件を満たす印の付け方における印の数の最大値を f(n) とする。すべての n ≥ 1 で f(n) に等しい n の式を求めよ。
答えは n を使った 1 つの式で書く。場合分けが必要なら Mod(a, b)（a を b で割った余り）や floor などで 1 つの式にまとめること。照合は多くの n で値を比べて行う。`,
		traps: [
			"小さい n から推した規則が n を 4 で割った余りで変わる",
			"上界の証明なしの推測",
		],
	}),
	defineDiscoveryTask({
		id: "hz7-gf-strip-tiling",
		level: 4,
		title: "2 × n の帯の敷き詰め（隣り合わないモノミノ）の母関数",
		kind: "series",
		statement: `2 × n の長方形（2 行 n 列）を、次のタイルで隙間なく重なりなく敷き詰める: 1 × 1 の正方形（モノミノ）、1 × 2 のドミノ（横置き・縦置き）、2 × 2 の正方形から 1 マスを除いた L 字形のトロミノ（4 つの向き）。ただし、2 つのモノミノが辺を共有してはならない（頂点だけの共有はよい）。
敷き詰め方の数を a(n) とする（a(0) = 1 とする。タイルの区別はなく、どのマスがどのタイルに属するかが違えば別の敷き詰め方）。
母関数 Σ_{n≥0} a(n) x^n を x の有理式（多項式 / 多項式）として求めよ。照合は多くの係数を比べて行う。`,
		traps: ["モノミノ同士の隣接の扱い", "列をまたぐ状態の取り漏れ"],
	}),
];
