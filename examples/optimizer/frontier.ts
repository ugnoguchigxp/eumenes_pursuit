import { readFile } from "node:fs/promises";
import type { Workload } from "../../eval/optimizer/data.ts";

/**
 * Optimizer forms of the frontier problems (mathematics, physics, chemistry). The starter
 * answers part of the tiers with a plausible but wrong method and is too slow for the large
 * inputs. Inputs and expected outputs are files written by eval/tasks/e/frontier/generate.py.
 */
export const frontierStarters = {
	bracelets: {
		timing: ["mixed", "wide", "long"],
		subject: "ブレスレットの数え上げ",
		flaw: "非対称な行列と一部の法で誤った答えを出し、n に比例する反復のため大きな n では終わらない",
	},
	"ising-ring": {
		timing: ["mixed", "thermal", "ordered"],
		subject: "横磁場イジング環の厳密な値",
		flaw: "有限の環では成り立たない近似を使うため多くの問いで誤り、必要のない計算を繰り返すため遅い",
	},
	equilibrium: {
		timing: ["mixed", "ideal", "davies"],
		subject: "沈殿を含む水溶液の平衡",
		flaw: "活量の補正と固相の選び方が不完全で一部の系で誤り、反復の刻みが小さいため大きな系では終わらない",
	},
} as const;

export type FrontierStarter = keyof typeof frontierStarters;
export const isFrontier = (name: string): name is FrontierStarter =>
	Object.hasOwn(frontierStarters, name);

const text = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const source = (name: FrontierStarter, file: string) =>
	text(`../../eval/tasks/e/frontier/${name}/${file}`);
async function workload(name: FrontierStarter, id: string): Promise<Workload> {
	const [input, expected] = await Promise.all([
		text(`./frontier/${name}/${id}.in`),
		text(`./frontier/${name}/${id}.out`),
	]);
	return { id, input, expected };
}
const tiers = (name: FrontierStarter, prefix: string) =>
	Promise.all([1, 2, 3, 4, 5].map((t) => workload(name, `${prefix}-t${t}`)));

/** A correct program that is clearly slower than a good one: the control for timing. */
async function baseline(name: FrontierStarter, reference: string) {
	if (name === "bracelets") return source(name, "baseline.py");
	const replace = (from: string, to: string) => {
		if (reference.split(from).length !== 2)
			throw new Error(`optimizer_frontier_baseline_changed:${name}`);
		reference = reference.replace(from, to);
	};
	if (name === "ising-ring")
		replace("getcontext().prec = 130", "getcontext().prec = 300");
	else {
		replace(
			"def main():",
			(await source(name, "baseline-patch.py")) + "def main():",
		);
		replace(
			"render(*solve(*case, hydrogen_start=start), extra)",
			"render(*slow_solve(*case), extra)",
		);
	}
	return reference;
}

/** The Solver's README with the Optimizer's file name and limits. */
async function specification(name: FrontierStarter) {
	const readme = await text(
		`../../eval/tasks/e/env-work/hz13-${name}/README.md`,
	);
	// Tier 6 belongs to the Solver task only: its inputs do not fit the 3-second limit.
	const [body] = readme.split(/## (?:段階6|制約)/);
	return (
		body!
			.replaceAll("solve.py", "windowsum.py")
			.replace(/\| 6 \|[^\n]*\n/, "")
			.replace(/（段階6は[^）]*）/g, "")
			.replace(/隠された検査は6段階あり[^\n]*\n/, "入力は次の5段階にわたる。\n")
			.replace(/例（`samples\/t1\.in` の形式）/, "例") +
		"## 制約\n\n- 使えるのは Python 3 の標準ライブラリだけ。ネットワークはない。\n- 1回の実行の制限時間は 3 秒。\n"
	);
}

export async function frontierFixture(name: FrontierStarter) {
	const { timing, subject, flaw } = frontierStarters[name];
	const reference = await source(name, "reference.py");
	return {
		initialSource: await text(`./starters/${name}.py`),
		baselineSource: await baseline(name, reference),
		expectedCorrect: false,
		reference,
		specification: await specification(name),
		goal: `windowsum.py は README.md の${subject}に答えるプログラムだが、${flaw}。解法の誤りを突き止めて直し、README.md の全段階の入力に正しく答え、大きな入力を1実行3秒以内に処理する版にする。正しさと速度を検証した最良版を提出する。`,
		correctnessText: "README.md の5段階すべての開発用検査に正しく答える",
		speedText: "段階4・5の規模の入力を各実行3秒以内に処理する",
		correctness: await tiers(name, "check"),
		timing: await Promise.all(
			timing.map((kind) => workload(name, `timing-${kind}`)),
		),
		large: [await workload(name, "large")],
	};
}

export async function frontierHeldOut(name: FrontierStarter) {
	return {
		correctness: await tiers(name, "heldout-check"),
		speed: await Promise.all(
			["a", "b", "c"].map((part) => workload(name, `heldout-large-${part}`)),
		),
	};
}
