import { resolve } from "node:path";

/** Kinds of machine-checked discovery answers (eval/tools/discovery.py). */
export type DiscoveryKind = "integer" | "formula" | "series" | "construction";

/** Names an expression may use, per kind. Anything else is refused before Python sees it. */
export const discoveryNames: Record<
	Exclude<DiscoveryKind, "construction">,
	readonly string[]
> = {
	integer: ["binomial", "factorial"],
	formula: ["n", "floor", "ceiling", "Mod", "binomial", "factorial", "Abs"],
	series: ["x"],
};

const MAX_EXPRESSION = 400;

/** Null when the expression is safe to hand to the checker; else a short reason. */
export function discoveryExpressionError(
	text: string,
	kind: Exclude<DiscoveryKind, "construction">,
): string | null {
	if (!text.trim()) return "式が空です";
	if (text.length > MAX_EXPRESSION) return "式が長すぎます";
	if (!/^[0-9A-Za-z+\-*/^()., \t]+$/.test(text))
		return "使えない文字があります（数字・英字・+ - * / ^ ( ) , . だけ）";
	if (/\*\*|__|\.\s*[A-Za-z_]/.test(text)) return "使えない書き方があります";
	const allowed = discoveryNames[kind];
	for (const name of text.match(/[A-Za-z]+/g) ?? [])
		if (!allowed.includes(name))
			return `使えない名前: ${name}（使える名前: ${allowed.join(", ") || "なし"}）`;
	return null;
}

/** Null when the grid text has the right shape; else a short reason (rules are checked in Python). */
export function constructionShapeError(
	grid: string,
	rows: number,
	cols: number,
): string | null {
	const lines = grid
		.trim()
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length !== rows || lines.some((l) => l.length !== cols))
		return `盤は ${rows} 行、各行 ${cols} 文字で書いてください`;
	if (lines.some((l) => /[^#.]/.test(l))) return "使える文字は # と . だけです";
	return null;
}

const script = resolve(import.meta.dir, "discovery.py");

export async function runDiscovery(request: {
	kind: DiscoveryKind;
	submission: Record<string, unknown>;
	spec?: Record<string, unknown>;
	secret: Record<string, unknown>;
}): Promise<{ ok: boolean; reason: string }> {
	const proc = Bun.spawn(["python3", "-P", script], {
		stdin: new TextEncoder().encode(JSON.stringify(request)),
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		timeout: 30_000,
		killSignal: "SIGKILL",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	if (code !== 0) return { ok: false, reason: "照合できませんでした" };
	return JSON.parse(out) as { ok: boolean; reason: string };
}
