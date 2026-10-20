import { resolve } from "node:path";
import katex from "katex";

export interface MathSegment {
	readonly tex: string;
	readonly display: boolean;
}

/** $$…$$, \[…\], $…$ and \(…\) in document order. Escaped \$ is text. */
export function mathSegments(text: string): MathSegment[] {
	const out: MathSegment[] = [];
	const pattern =
		/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|(?<!\\)\$([^$\n]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g;
	for (const m of text.matchAll(pattern)) {
		const display = m[1] !== undefined || m[2] !== undefined;
		out.push({ tex: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim(), display });
	}
	return out;
}

export interface TexReport {
	readonly segments: number;
	readonly errors: readonly {
		readonly tex: string;
		readonly message: string;
	}[];
}

export function checkTex(text: string): TexReport {
	const segments = mathSegments(text);
	const errors: { tex: string; message: string }[] = [];
	for (const s of segments) {
		try {
			katex.renderToString(s.tex, {
				displayMode: s.display,
				throwOnError: true,
				strict: "ignore",
			});
		} catch (error) {
			errors.push({
				tex: s.tex.slice(0, 120),
				message: (error instanceof Error ? error.message : String(error)).slice(
					0,
					200,
				),
			});
		}
	}
	return { segments: segments.length, errors };
}

export const checkNames = [
	"pi",
	"E",
	"sqrt",
	"log",
	"ln",
	"exp",
	"sin",
	"cos",
	"tan",
	"atan",
	"asin",
	"acos",
	"zeta",
	"Catalan",
	"EulerGamma",
	"factorial",
	"binomial",
	"gamma",
	"polylog",
	"Rational",
	"Abs",
] as const;

export interface CheckItem {
	readonly line: string;
	readonly lhs: string;
	readonly op: "<" | ">" | "<=" | ">=" | "=";
	readonly rhs: string;
}

/**
 * Validate one plain expression: digits, operators, parentheses and allow-listed
 * names only. Returns the reason it is refused, or null.
 */
export function expressionError(
	text: string,
	forbid: readonly string[] = [],
): string | null {
	if (text.length > 300) return "式が長すぎます";
	if (!/^[0-9A-Za-z+\-*/^()., \t]+$/.test(text))
		return "使える記号は数字・+ - * / ^ ( ) , . と許可された関数名だけです";
	for (const name of text.match(/[A-Za-z]+/g) ?? []) {
		if (!(checkNames as readonly string[]).includes(name))
			return `使えない名前: ${name}`;
		if (forbid.includes(name)) return `この問題では ${name} を検算に使えません`;
	}
	return null;
}

/** The ```checks block of a proof: one inequality or equation per line. */
export function parseChecks(
	text: string,
	forbid: readonly string[],
): { items: CheckItem[]; errors: string[]; found: boolean } {
	const block = /```checks\s*\n([\s\S]*?)```/.exec(text);
	if (!block) return { items: [], errors: [], found: false };
	const items: CheckItem[] = [];
	const errors: string[] = [];
	for (const raw of (block[1] ?? "").split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = /^(.+?)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(line);
		if (!m) {
			errors.push(`${line}: 不等式・等式になっていません`);
			continue;
		}
		const [, lhs = "", op = "=", rhs = ""] = m;
		const error = expressionError(lhs, forbid) ?? expressionError(rhs, forbid);
		if (error) {
			errors.push(`${line}: ${error}`);
			continue;
		}
		items.push({ line, lhs, op: op as CheckItem["op"], rhs });
	}
	return { items, errors, found: true };
}

const script = resolve(import.meta.dir, "mathcheck.py");

export interface CheckResult {
	readonly ok: boolean;
	readonly assurance?: "exact" | "numeric";
	readonly value?: string;
	readonly rhs?: string;
	readonly error?: string;
}

/** Exact (60-digit) evaluation in a python subprocess; inputs are pre-validated. */
export async function runMath(request: {
	items: readonly CheckItem[];
	evaluate?: string;
	evalDigits?: number;
}): Promise<CheckResult[]> {
	const proc = Bun.spawn(["python3", "-P", script], {
		stdin: new TextEncoder().encode(
			JSON.stringify({
				items: request.items.map(({ lhs, op, rhs }) => ({ lhs, op, rhs })),
				digits: 60,
				...(request.evaluate === undefined
					? {}
					: {
							evaluate: request.evaluate,
							evalDigits: request.evalDigits ?? 30,
						}),
			}),
		),
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		timeout: 20_000,
		killSignal: "SIGKILL",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`mathcheck_failed:${code}`);
	return JSON.parse(out) as CheckResult[];
}
