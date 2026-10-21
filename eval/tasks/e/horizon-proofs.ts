import type { EvalTask } from "../../contracts.ts";
import { defineReasoningTask } from "./kit.ts";

/**
 * horizon-6: proof tasks graded against external rubrics. The rubrics (weighted checkpoints,
 * fatal errors, threshold) and the reference proofs are NOT in this repository: the host loads
 * `<--rubric-dir>/<id>.json` when grading (proof-grader.ts), and only the grader's request
 * contains them. Each statement lists what may be cited, so the proof is self-contained.
 */
const noNumerics =
	"数値計算や小さい場合の確認は証明の代わりにならない。引用した定理は名前を挙げ、仮定を満たすことを確かめること。";

export const horizon6Tasks: readonly EvalTask[] = [
	defineReasoningTask({
		id: "hz6-proof-alt-euler-7",
		domain: "math",
		level: 4,
		title: "重さ 7 の交代オイラー和の証明",
		statement: `H_n^{(2)} = Σ_{k=1}^{n} 1/k^2、ζ(s) = Σ_{n=1}^∞ n^{−s}（s > 1）とする。次の等式を証明せよ。
Σ_{n=1}^∞ (−1)^{n+1} H_n^{(2)} / n^5 = (7/4) ζ(3) ζ(4) + (49/32) ζ(2) ζ(5) − (249/64) ζ(7)。
証明なしに引用してよい事実: 複素解析の標準的な定理（留数定理など）、ガンマ関数とディガンマ関数 ψ = Γ'/Γ およびその導関数の基本性質（級数表示・相反公式・漸化式・テイラー展開）、π/sin(πz) のローラン展開、ζ(2) = π^2/6 と ζ(4) = π^4/90、実解析の標準的な定理（優収束定理・Fubini の定理・Abel の定理など）。この級数の値、および H_n^{(k)} や H_n を含む他の級数（オイラー和、交代・非交代を問わない）の閉じた式は、既知として引用してはならない（使うなら証明すること）。${noNumerics}`,
		document: true,
		numericChecks: false,
		rubricId: "hz6-proof-alt-euler-7",
		rubricSize: 6,
		traps: [
			"既知のオイラー和の値の引用（循環）",
			"級数・積分の交換や周回積分の消滅を正当化しない",
		],
	}),
	defineReasoningTask({
		id: "hz6-proof-binomial-mod-p",
		domain: "math",
		level: 4,
		title: "中心二項係数の和の合同式",
		statement: `p を 5 以上の素数とし、C(n, k) を二項係数とする。次の 2 つを証明せよ。
(a) Σ_{k=0}^{p−1} C(2k, k) ≡ (p/3) (mod p)。ここで (p/3) はルジャンドル記号で、p ≡ 1 (mod 3) なら 1、p ≡ 2 (mod 3) なら −1。
(b) Σ_{k=1}^{p−1} C(2k, k)·k^{−1} ≡ 0 (mod p)。ここで k^{−1} は k の mod p での逆元。
証明なしに引用してよい事実: フェルマーの小定理、オイラーの規準、平方剰余の相互法則（補充法則を含む）、Lucas の定理、ウィルソンの定理、二項定理。(a)・(b) そのもの、および中心二項係数 C(2k, k) の和に関する他の合同式は、既知として引用してはならない。${noNumerics}`,
		document: true,
		numericChecks: false,
		rubricId: "hz6-proof-binomial-mod-p",
		rubricSize: 6,
		traps: ["小さい p での確認で済ませる", "(b) の核心の合同式の飛躍"],
	}),
	defineReasoningTask({
		id: "hz6-proof-discrete-wirtinger",
		domain: "math",
		level: 4,
		title: "端の条件が混ざった離散ウィルティンガー不等式",
		statement: `n ≥ 1 を整数とする。実数 a_1, …, a_n に対して a_0 = 0 とおく。
すべての実数 a_1, …, a_n について Σ_{k=1}^{n} (a_k − a_{k−1})^2 ≥ c Σ_{k=1}^{n} a_k^2 が成り立つような最大の定数 c = c_n を、n の閉じた式で求めよ。そのうえで、(1) この c_n で不等式が成り立つこと、(2) c_n より大きい定数では成り立たないこと、(3) 等号が成り立つ (a_1, …, a_n) をすべて決定すること、を証明せよ。
証明なしに引用してよい事実: 実対称行列のスペクトル定理（直交行列による対角化）、三角関数の加法定理・和積公式などの初等的な事実。${noNumerics}`,
		document: true,
		numericChecks: false,
		rubricId: "hz6-proof-discrete-wirtinger",
		rubricSize: 6,
		traps: ["端の条件を両端固定と取り違える", "等号条件の決定の欠落"],
	}),
	defineReasoningTask({
		id: "hz6-proof-commutator-nilpotent",
		domain: "math",
		level: 4,
		title: "AB − BA = A を満たす行列",
		statement: `A, B を複素数を成分とする n × n 行列とし、AB − BA = A を満たすとする。次を証明せよ。
(i) A は冪零である（ある m ≥ 1 で A^m = 0）。
(ii) ある正則行列 P があって、P^{−1}AP と P^{−1}BP がともに上三角行列になる。
(iii) 複素数体を素数 p 元の有限体 F_p に置き換えると、(i) は一般には成り立たない。すべての素数 p について、F_p の元を成分とする行列 A, B で AB − BA = A を満たし、A が冪零でない例を挙げ、そのことを確かめよ。
証明なしに引用してよい事実: 線形代数の標準的な事実（代数閉体上の固有値の存在、ジョルダン標準形、ケーリー・ハミルトンの定理、ニュートンの恒等式、商空間の基本性質）。(ii) の結論を直接与える定理（リーの定理、エンゲルの定理、同時三角化の一般定理など）は引用してはならない。${noNumerics}`,
		document: true,
		numericChecks: false,
		rubricId: "hz6-proof-commutator-nilpotent",
		rubricSize: 6,
		traps: [
			"同時三角化の定理を引用する",
			"標数 p の例が一部の p でしか成り立たない",
		],
	}),
];
