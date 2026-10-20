import type { EvalTask } from "../../contracts.ts";
import { defineReasoningTask } from "./kit.ts";

const noTrig = ["pi", "sin", "cos", "tan", "atan", "asin", "acos"];
const noCircularity = {
	id: "no-circularity",
	text: "示したい量（π など）の近似値や、示したい結論そのものを前提に使っていない",
};
const exactClaim = {
	id: "exact-claim",
	text: "問題の主張そのものを結論として明示的に導いている（弱い主張・別の主張・数値例へのすり替えがない）",
};
const noGaps = {
	id: "no-gaps",
	text: "各段の推論に飛躍がなく、使った定理・公式の適用条件を満たしている",
};

/** Level 1: entrance exam. Level 2: undergraduate. Level 3: graduate. Level 4: research / HLE-style. */
export const reasoningTasks: readonly EvalTask[] = [
	defineReasoningTask({
		id: "e1-pi-gt-305",
		domain: "math",
		level: 1,
		title: "円周率が 3.05 より大きいことの証明",
		statement: "円周率が 3.05 より大きいことを証明せよ。",
		document: true,
		numericChecks: true,
		forbid: noTrig,
		rubric: [
			noCircularity,
			{
				id: "bound-quantity",
				text: "π を下から評価する量（内接正多角形の周長・面積など）を正しく導き、それが π の定義（円周/直径）と正しく比較されている",
			},
			{
				id: "irrational-estimates",
				text: "√2・√3・√6 などの評価を、二乗の比較などで正しく示している",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"単位円（半径 1）の内接正 12 角形の 1 辺は 2sin15° = (√6−√2)/2、周長 6(√6−√2) < 2π。√6 > 2.449（2.449² < 6）、√2 < 1.415（1.415² > 2）から 6(√6−√2) > 6×1.034 = 6.204 > 6.1、よって π > 3.05。内接正 8 角形（周長 8√(2−√2)）でもよい。",
		traps: [
			"π≈3.14 を使う循環",
			"正6角形（π>3）で止める弱い主張",
			"√ の評価を示さない",
		],
	}),
	defineReasoningTask({
		id: "e2-sqrt-sum-vs-pi",
		domain: "math",
		level: 2,
		title: "√2+√3 と π の大小",
		statement: "√2 + √3 と π の大小を判定し、それを証明せよ。",
		document: true,
		numericChecks: true,
		forbid: noTrig,
		rubric: [
			noCircularity,
			{ id: "correct-order", text: "√2 + √3 > π と正しく判定している" },
			{
				id: "upper-bound-pi",
				text: "π の上からの評価（3.1462 未満を示せる十分に強いもの）を厳密に導いている（外接多角形、arctan の級数の誤差評価、積分など）",
			},
			{
				id: "lower-bound-sum",
				text: "√2 + √3 の下からの評価を厳密に示している",
			},
			noGaps,
		],
		reference:
			"√2+√3 > 1.4142+1.7320 = 3.1462。π < 22/7 = 3.1428…（∫₀¹ x⁴(1−x)⁴/(1+x²) dx = 22/7 − π > 0）、または π = 16 arctan(1/5) − 4 arctan(1/239) と交代級数の誤差評価。外接正 n 角形なら n=48 程度が必要で、正 12・24 角形では足りない。",
		traps: [
			"外接正12・24角形では評価が足りない",
			"π の上界を示さず小数で比べる",
		],
	}),
	defineReasoningTask({
		id: "e2-pi-lt-22-7",
		domain: "math",
		level: 2,
		title: "π < 22/7 の証明",
		statement: "π < 22/7 であることを証明せよ。",
		document: true,
		numericChecks: false,
		rubric: [
			noCircularity,
			{
				id: "key-identity",
				text: "π と 22/7 の差を、符号の分かる量（正の被積分関数の積分など）で厳密に表している",
			},
			{
				id: "computation",
				text: "多項式の割り算・積分などの計算が正しく、省略されていない",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"x⁴(1−x)⁴/(1+x²) = x⁶ − 4x⁵ + 5x⁴ − 4x² + 4 − 4/(1+x²)。[0,1] で積分すると 22/7 − π。被積分関数は (0,1) で正なので 22/7 − π > 0。",
		traps: ["小数 3.1415… との比較で済ませる", "多項式の割り算を示さない"],
	}),
	defineReasoningTask({
		id: "e2-irrational-sqrt-sum",
		domain: "math",
		level: 2,
		title: "√2+√3 の無理数性",
		statement: "√2 + √3 が無理数であることを証明せよ。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "contradiction-setup",
				text: "有理数と仮定する（または最小多項式を用いる）論法を正しく立てている",
			},
			{
				id: "uses-irrationality",
				text: "√6 や √2 の無理数性を使うなら、それ自体を示すか、使ってよい事実として正しく扱っている",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"r = √2+√3 が有理数なら r² = 5 + 2√6 より √6 = (r²−5)/2 が有理数、矛盾（√6 の無理数性は素因数分解または有理根定理で示す）。または x⁴ − 10x² + 1 の有理根は ±1 のみで、どちらも根でない。",
		traps: ["√6 の無理数性を無根拠に使う"],
	}),
	defineReasoningTask({
		id: "e3-group-order-15",
		domain: "math",
		level: 3,
		title: "位数 15 の群",
		statement: "位数 15 の群はすべて巡回群であることを証明せよ。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "sylow-counts",
				text: "シローの定理から 3-シロー・5-シロー部分群の個数がともに 1 であることを正しく導いている",
			},
			{
				id: "normal-and-product",
				text: "両者が正規で、交わりが自明で、積が群全体になることを示している",
			},
			{
				id: "cyclic",
				text: "その結果として群が巡回群であることを正しく結論している（直積 C₃×C₅ ≅ C₁₅ など）",
			},
			noGaps,
		],
		reference:
			"n₃ ≡ 1 (mod 3), n₃ | 5 ⇒ n₃ = 1。n₅ ≡ 1 (mod 5), n₅ | 3 ⇒ n₅ = 1。P, Q は正規、P∩Q = 1、|PQ| = 15 ⇒ G ≅ P×Q ≅ C₃×C₅ ≅ C₁₅（gcd(3,5)=1）。",
		traps: ["正規性から直積への議論の省略"],
	}),
	defineReasoningTask({
		id: "e3-serret-integral",
		domain: "math",
		level: 3,
		title: "∫ ln(1+x)/(1+x²)",
		statement:
			"定積分 I = ∫₀¹ ln(1+x)/(1+x²) dx の値を求め、その値であることを証明せよ。",
		document: true,
		numericChecks: false,
		answer: "pi*log(2)/8",
		rubric: [
			{ id: "method", text: "値を導く変形（置換・対称性など）がすべて正しい" },
			{ id: "value", text: "I = (π/8) ln 2 を正しく結論している" },
			noGaps,
		],
		reference:
			"x = tan θ で I = ∫₀^{π/4} ln(1+tan θ) dθ。θ → π/4 − θ で 1+tan(π/4−θ) = 2/(1+tan θ)。足して 2I = (π/4) ln 2。",
		traps: ["数値積分による値の推測だけで済ませる"],
	}),
	defineReasoningTask({
		id: "e3-alternating-harmonic",
		domain: "math",
		level: 3,
		title: "交代調和数の級数",
		statement:
			"H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ (−1)^{n+1} H_n / n の値を閉じた式で求めよ。",
		document: false,
		numericChecks: false,
		answer: "pi^2/12 - log(2)^2/2",
		traps: ["既知の値の思い出し違い"],
	}),
	defineReasoningTask({
		id: "e4-euler-sum-h2",
		domain: "math",
		level: 4,
		title: "Euler 和 Σ (H_n/n)²",
		statement:
			"H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ (H_n / n)² の値を閉じた式で求めよ。",
		document: false,
		numericChecks: false,
		answer: "17*pi^4/360",
		traps: ["Σ H_n/n² = 2ζ(3) などとの混同"],
	}),
	defineReasoningTask({
		id: "e3-arctan-integral",
		domain: "math",
		level: 3,
		title: "∫ arctan x / (x√(1−x²))",
		statement: "定積分 ∫₀¹ arctan(x) / (x √(1−x²)) dx の値を閉じた式で求めよ。",
		document: false,
		numericChecks: false,
		answer: "pi/2*log(1+sqrt(2))",
		traps: ["パラメータ微分の符号・定数の取り違え"],
	}),
	defineReasoningTask({
		id: "e4-harmonic-half",
		domain: "math",
		level: 4,
		title: "Σ H_n / (n² 2ⁿ)",
		statement:
			"H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ H_n / (n² 2ⁿ) の値を閉じた式で求めよ。",
		document: false,
		numericChecks: false,
		answer: "zeta(3) - pi^2*log(2)/12",
		traps: ["多重対数 Li₃(1/2) の値の取り違え"],
	}),
	defineReasoningTask({
		id: "e4-alt-euler-cubic",
		domain: "math",
		level: 4,
		title: "交代 Euler 和 Σ (−1)^{n+1} H_n / n³",
		statement:
			"H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ (−1)^{n+1} H_n / n³ の値を、π、ln 2、ζ(3)、Li₄(1/2) などを用いた閉じた式で求めよ。",
		document: false,
		numericChecks: false,
		answer:
			"11*pi^4/360 - log(2)^4/12 + pi^2*log(2)^2/12 - 2*polylog(4,1/2) - 7*zeta(3)*log(2)/4",
		traps: ["ln 2 の項の符号の覚え違い（実際に作成者も間違えた）"],
	}),
	defineReasoningTask({
		id: "e4-pi-squared-irrational",
		domain: "math",
		level: 4,
		title: "π² の無理数性",
		statement:
			"π² が無理数であることを証明せよ。π や π² の無理数性・超越性を直接含む定理（Lindemann の定理など）は引用せず、証明の中で示すこと。手法は問わない。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "construction",
				text: "矛盾を導くための補助関数・積分・近似の列など（Niven 型の多項式 f(x) = xⁿ(1−x)ⁿ/n!、Hermite 型の積分、連分数など、手法は問わない）を正しく構成している",
			},
			{
				id: "integrality",
				text: "仮定（π² = a/b）のもとで、ある量が整数になることを正しく示している",
			},
			{
				id: "bounds",
				text: "その整数が 0 と 1 の間（0 < … < 1）にあることを、n を十分大きくとって正しく評価している",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"π² = a/b と仮定。f(x) = xⁿ(1−x)ⁿ/n!、F(x) = bⁿ Σ_k (−1)^k π^{2n−2k} f^{(2k)}(x)。F(0), F(1) は整数。d/dx[F′ sin πx − πF cos πx] = π² aⁿ f(x) sin πx。よって π aⁿ ∫₀¹ f sin πx dx = F(0)+F(1) は整数だが、0 < … < π aⁿ/n! < 1（n 大）で矛盾。",
		traps: [
			"π の無理数性だけを示して π² に言及しない",
			"F(0), F(1) の整数性の省略",
		],
	}),
	defineReasoningTask({
		id: "e4-zeta3-irrational",
		domain: "math",
		level: 4,
		title: "ζ(3) の無理数性",
		statement:
			"ζ(3) = Σ_{n=1}^∞ 1/n³ が無理数であることを証明せよ。ζ(3) の無理数性そのもの（Apéry の定理）は引用せず、証明の中で示すこと。素数定理など ζ(3) と無関係な標準的な結果は引用してよい。手法は問わない。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "construction",
				text: "ζ(3) の有理近似の列（Beukers の積分、Apéry の数列など）を正しく構成している",
			},
			{
				id: "integrality",
				text: "近似の分母の整数性（d_n³ を掛けると整数になる等）を正しく示している",
			},
			{
				id: "smallness",
				text: "誤差項が 0 でなく、d_n³ を掛けても 0 に収束することを正しい評価で示している",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"Beukers: ∫₀¹∫₀¹ −ln(xy)/(1−xy) P_n(x)P_n(y) dx dy = (a_n + b_n ζ(3))/d_n³（a_n, b_n ∈ ℤ, d_n = lcm(1..n)）。三重積分表示と部分積分で、0 < |…| ≤ 2(√2−1)^{4n} ζ(3)。d_n ≤ 3^n（素数定理による評価 d_n < e^{n(1+ε)} でもよい）から 27^n (√2−1)^{4n} → 0、矛盾。",
		traps: ["d_n の評価の省略", "誤差項が 0 でないことの省略"],
	}),
];
