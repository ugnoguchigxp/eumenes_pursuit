import { resolve } from "node:path";

/**
 * Counterexample formats for hidden-truth tasks (eval/tasks/e/verdict.ts). The shape is checked
 * here when the executor submits (it depends only on the submission); whether the data actually
 * violates the statement is decided by counterexample.py at verification time.
 */
export type CounterexampleFormat =
	| { readonly type: "integer" }
	| { readonly type: "rationals"; readonly minN: number; readonly maxN: number }
	| {
			readonly type: "rational-matrix";
			readonly minN: number;
			readonly maxN: number;
	  }
	| {
			readonly type: "binary-matrix";
			readonly minN: number;
			readonly maxN: number;
	  };

/** Rule passed to counterexample.py (name plus the statement's parameters). */
export type CounterexampleRule = Readonly<Record<string, unknown>> & {
	readonly name:
		| "gcd-shift"
		| "cyclic-ratio"
		| "skew-rank"
		| "tournament-rank"
		| "gcd-form";
};

const RATIONAL = /^-?\d{1,60}(\/\d{1,60})?$/;
const MAX_DATA = 20_000;

export function counterexampleShapeError(
	data: string,
	format: CounterexampleFormat,
): string | null {
	if (!data.trim()) return "空です";
	if (data.length > MAX_DATA) return "長すぎます";
	switch (format.type) {
		case "integer":
			return /^\s*\d{1,40}\s*$/.test(data) && BigInt(data.trim()) >= 1n
				? null
				: "正の整数（40 桁まで）を 10 進で書いてください";
		case "rationals": {
			const items = data
				.replace(/\n/g, ",")
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
			if (items.length < format.minN || items.length > format.maxN)
				return `個数は ${format.minN} 以上 ${format.maxN} 以下です`;
			if (!items.every((t) => RATIONAL.test(t)))
				return "有理数（整数または p/q）をカンマ区切りで書いてください";
			if (items.some((t) => /\/0+$/.test(t))) return "分母が 0 です";
			return null;
		}
		case "rational-matrix": {
			const rows = data
				.trim()
				.split("\n")
				.map((r) => r.trim())
				.filter(Boolean)
				.map((r) => r.split(/[\s,]+/).filter(Boolean));
			const n = rows.length;
			if (
				n < format.minN ||
				n > format.maxN ||
				rows.some((r) => r.length !== n)
			)
				return `${format.minN} 以上 ${format.maxN} 以下の n について n 行 n 列で書いてください`;
			if (!rows.flat().every((t) => RATIONAL.test(t)))
				return "成分は有理数（整数または p/q）だけです";
			if (rows.flat().some((t) => /\/0+$/.test(t))) return "分母が 0 です";
			return null;
		}
		case "binary-matrix": {
			const rows = data
				.trim()
				.split("\n")
				.map((r) => r.trim())
				.filter(Boolean);
			const n = rows.length;
			if (
				n < format.minN ||
				n > format.maxN ||
				rows.some((r) => r.length !== n)
			)
				return `${format.minN} 以上 ${format.maxN} 以下の n について n 行、各行 n 文字で書いてください`;
			if (rows.some((r) => /[^01]/.test(r)))
				return "使える文字は 0 と 1 だけです";
			return null;
		}
	}
}

const script = resolve(import.meta.dir, "counterexample.py");

export async function runCounterexample(request: {
	rule: CounterexampleRule;
	data: string;
}): Promise<{ ok: boolean; reason: string }> {
	const proc = Bun.spawn(["python3", "-P", script], {
		stdin: new TextEncoder().encode(JSON.stringify(request)),
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		timeout: 60_000,
		killSignal: "SIGKILL",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	if (code !== 0) return { ok: false, reason: "照合できませんでした" };
	return JSON.parse(out) as { ok: boolean; reason: string };
}
