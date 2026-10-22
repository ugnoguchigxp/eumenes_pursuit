import type { JsonValue } from "../../contracts/index.ts";

/**
 * Machine-checkable refutedIf (spec/fixes-2026-10-22.md §b): clauses status:ok, status:error,
 * contains:"…" and not_contains:"…", joined by "||" (any clause true = refuted). One clause plus
 * its separator per match; sticky, so "||" inside a quoted needle is not a separator.
 */
const CLAUSE =
	/\s*(status:(ok|error)|(not_contains|contains):"((?:[^"\\]|\\.)*)")\s*(\|\||$)/y;

/** Clauses of a machine-checkable refutedIf, or null when any part is free text. */
function parseClauses(refutedIf: string): RegExpExecArray[] | null {
	const out: RegExpExecArray[] = [];
	CLAUSE.lastIndex = 0;
	while (CLAUSE.lastIndex < refutedIf.length) {
		const m = CLAUSE.exec(refutedIf);
		if (!m) return null;
		out.push(m);
		if (!m[5]) break;
	}
	// A trailing "||" with no clause after it is not machine-checkable.
	return CLAUSE.lastIndex === refutedIf.length &&
		out.length > 0 &&
		!out.at(-1)![5]
		? out
		: null;
}

/** The needle as written: JSON string escapes (\", \\, \n, \u…); otherwise a backslash drops. */
function unescapeNeedle(raw: string): string {
	try {
		return JSON.parse(`"${raw}"`) as string;
	} catch {
		return raw.replace(/\\(.)/g, "$1");
	}
}

function stringLeaves(value: JsonValue | undefined, out: string[] = []) {
	if (typeof value === "string") out.push(value);
	else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
	else if (value && typeof value === "object")
		for (const v of Object.values(value)) stringLeaves(v, out);
	else if (value !== null && value !== undefined) out.push(String(value));
	return out;
}

/** Whether refutedIf parses as machine-checkable clauses. */
export function refutationCheckable(refutedIf: string | undefined): boolean {
	return !!refutedIf?.trim() && parseClauses(refutedIf) !== null;
}

/**
 * Whether the stated refutedIf held for the observation: true / false when every clause is
 * machine-checkable, null otherwise (free text, or nothing observed). A needle is searched in each
 * string value and in the observation's JSON text, which is the form the generator was shown
 * (so `"output":"41"` written with escaped quotes matches).
 */
export function refutationHeld(
	refutedIf: string | undefined,
	observation: { status: "ok" | "error"; output: JsonValue } | null | undefined,
): boolean | null {
	if (!refutedIf?.trim() || !observation) return null;
	const parsed = parseClauses(refutedIf);
	if (!parsed) return null;
	const texts = [
		...stringLeaves(observation.output),
		JSON.stringify(observation.output ?? null),
	];
	return parsed.some((m) => {
		if (m[2]) return observation.status === m[2];
		const needle = unescapeNeedle(m[4]!);
		const found = texts.some((t) => t.includes(needle));
		return m[3] === "contains" ? found : !found;
	});
}
