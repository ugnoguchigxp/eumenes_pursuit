import type { EvalTask } from "../../contracts.ts";
import { defineReasoningTask } from "./kit.ts";

/**
 * horizon-1 tasks (spec/long-horizon-design.md): closed-form evaluations one step
 * past the L4 Euler sums, derivable with standard methods (generating functions,
 * parity splitting, alternating Euler sums) but needing several stages. Answers are
 * checked by the 50-digit comparison only (no grader). Each value was found by PSLQ
 * on a 90-digit integral representation and confirmed to at least 69 digits by an
 * independent series or integral (eval/tasks/e/test/horizon-problems.test.ts).
 */
const names =
	"答えに使える名前: pi、log、zeta(s)、polylog(s, x)、有理数（必要なものだけ使えばよい）。";

export const horizonTasks: readonly EvalTask[] = [
	defineReasoningTask({
		id: "hz-odd-harmonic-3",
		domain: "math",
		level: 4,
		title: "奇数の分母の調和数の級数（重さ 4）",
		statement: `H_n = 1 + 1/2 + … + 1/n（H_0 = 0）とする。級数 Σ_{n=0}^∞ H_n / (2n+1)^3 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer: "pi^4/64 - 7*zeta(3)*log(2)/4",
		traps: [
			"Σ H_n/n^3 の値との取り違え",
			"偶奇の分解で H_n と奇数の調和数を混同する",
		],
	}),
	defineReasoningTask({
		id: "hz-even-index-harmonic-3",
		domain: "math",
		level: 4,
		title: "添字が偶数の調和数の級数（重さ 4）",
		statement: `H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ H_{2n} / n^3 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer:
			"-pi^4/15 + 7*zeta(3)*log(2) - pi^2*log(2)^2/3 + log(2)^4/3 + 8*polylog(4, 1/2)",
		traps: [
			"交代 Euler 和 Σ (−1)^n H_n/n^3 の符号や係数の思い出し違い",
			"H_{2n} を H_n で置き換える",
		],
	}),
	defineReasoningTask({
		id: "hz-alt-harmonic-sq-2",
		domain: "math",
		level: 4,
		title: "調和数の 2 乗の交代級数（重さ 4）",
		statement: `H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ (−1)^{n+1} H_n^2 / n^2 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer:
			"41*pi^4/1440 - 7*zeta(3)*log(2)/4 + pi^2*log(2)^2/12 - log(2)^4/12 - 2*polylog(4, 1/2)",
		traps: ["H_n^2 を H_n^{(2)} と取り違える", "交代でない級数の値を流用する"],
	}),
	defineReasoningTask({
		id: "hz-odd-harmonic-4",
		domain: "math",
		level: 4,
		title: "奇数の分母の調和数の級数（重さ 5）",
		statement: `H_n = 1 + 1/2 + … + 1/n（H_0 = 0）とする。級数 Σ_{n=0}^∞ H_n / (2n+1)^4 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer: "31*zeta(5)/8 - 7*pi^2*zeta(3)/32 - pi^4*log(2)/48",
		traps: [
			"重さ 4 の結果の係数をそのまま延長する",
			"(2n+1)^{-4} の積分表示の符号を落とす",
		],
	}),
];

/**
 * horizon-2 tasks: weight-5 sums (nonlinear, mixed parity, alternating, at 1/2) whose
 * closed forms are not textbook entries, so they have to be derived. Each value was
 * fitted by PSLQ at 110 digits in the 8-element weight-5 basis (zeta(5), pi^2 zeta(3),
 * pi^4 log 2, zeta(3) log^2 2, pi^2 log^3 2, log^5 2, Li4(1/2) log 2, Li5(1/2)) and
 * confirmed at 190 digits, and by an independent series where one converges fast.
 */
export const horizon2Tasks: readonly EvalTask[] = [
	defineReasoningTask({
		id: "hz2-odd-harmonic-sq-3",
		domain: "math",
		level: 4,
		title: "調和数の 2 乗と奇数の分母",
		statement: `H_n = 1 + 1/2 + … + 1/n（H_0 = 0）とする。級数 Σ_{n=0}^∞ H_n^2 / (2n+1)^3 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer:
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/48 - pi^4*log(2)/16 + 7*zeta(3)*log(2)^2/2",
		traps: [
			"H_n^2 を H_n^{(2)} と取り違える",
			"Σ H_n/(2n+1)^4 など隣の値の係数を流用する",
		],
	}),
	defineReasoningTask({
		id: "hz2-alt-harmonic2-3",
		domain: "math",
		level: 4,
		title: "2 次の調和数の交代級数",
		statement: `H_n^{(2)} = 1 + 1/2^2 + … + 1/n^2 とする。級数 Σ_{n=1}^∞ (−1)^{n+1} H_n^{(2)} / n^3 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer: "5*pi^2*zeta(3)/48 - 11*zeta(5)/32",
		traps: [
			"よく知られた Σ (−1)^{n+1} H_n/n^4 の値と取り違える",
			"交代でない Σ H_n^{(2)}/n^3 の値の符号だけ変えて流用する",
		],
	}),
	defineReasoningTask({
		id: "hz2-alt-harmonic-sq-3",
		domain: "math",
		level: 4,
		title: "調和数の 2 乗の交代級数（重さ 5）",
		statement: `H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ (−1)^{n+1} H_n^2 / n^3 の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer:
			"-19*zeta(5)/32 - 11*pi^2*zeta(3)/48 + 7*zeta(3)*log(2)^2/4 - pi^2*log(2)^3/9 + 2*log(2)^5/15 + 4*polylog(4, 1/2)*log(2) + 4*polylog(5, 1/2)",
		traps: [
			"多重対数の項（1/2 での値）を落とす",
			"重さ 4 の Σ (−1)^{n+1} H_n^2/n^2 の形をそのまま延長する",
		],
	}),
	defineReasoningTask({
		id: "hz2-harmonic-half-4",
		domain: "math",
		level: 4,
		title: "調和数と 2 の冪の級数（重さ 5）",
		statement: `H_n = 1 + 1/2 + … + 1/n とする。級数 Σ_{n=1}^∞ H_n / (n^4 2^n) の値を閉じた式で求めよ。${names}`,
		document: false,
		numericChecks: false,
		answer:
			"zeta(5)/32 - pi^2*zeta(3)/12 - pi^4*log(2)/720 + zeta(3)*log(2)^2/2 - pi^2*log(2)^3/36 + log(2)^5/40 + polylog(4, 1/2)*log(2) + 2*polylog(5, 1/2)",
		traps: [
			"重さ 4 の Σ H_n/(n^3 2^n) の形をそのまま延長する",
			"polylog(5, 1/2) の係数の取り違え",
		],
	}),
];
