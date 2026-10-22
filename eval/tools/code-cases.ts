import { isDeepStrictEqual } from "node:util";
import type { JsonValue } from "../../src/contracts/index.ts";

/** Expected values and comparators live only in the host. */
export interface CodeCase {
	readonly caseId: string;
	readonly criterionId: string;
	readonly modulePath: string;
	readonly exportName: string;
	readonly args: readonly JsonValue[];
	readonly expected?: JsonValue;
	readonly throws?: string;
}

export function caseRequests(cases: readonly CodeCase[]) {
	return cases.map(({ caseId, modulePath, exportName, args }) => ({
		caseId,
		modulePath,
		exportName,
		args,
	}));
}

/** Child output is untrusted data, never a verdict. Reject incomplete protocols. */
export function compareCaseResults(
	cases: readonly CodeCase[],
	stdout: string,
): ReadonlyMap<string, boolean> | null {
	try {
		const rows: unknown = JSON.parse(stdout);
		if (!Array.isArray(rows) || rows.length !== cases.length) return null;
		const expected = new Map(cases.map((c) => [c.caseId, c]));
		if (expected.size !== cases.length) return null;
		const result = new Map<string, boolean>();
		for (const row of rows) {
			if (
				!row ||
				typeof row !== "object" ||
				typeof row.caseId !== "string" ||
				result.has(row.caseId)
			)
				return null;
			const c = expected.get(row.caseId);
			if (!c) return null;
			result.set(
				c.caseId,
				c.throws !== undefined
					? row.kind === "throw" && row.name === c.throws
					: row.kind === "return" &&
							Object.hasOwn(row, "value") &&
							isDeepStrictEqual(row.value, c.expected),
			);
		}
		return result;
	} catch {
		return null;
	}
}

/** No expected outputs or assertions are written into this worker. */
export const caseWorker = String.raw`
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify.bind(JSON);
const parse = JSON.parse.bind(JSON);
const requests = parse(await Bun.stdin.text());
const results = [];
function valid(v, seen = new Set()) {
 if (v === null || typeof v === "string" || typeof v === "boolean") return true;
 if (typeof v === "number") return Number.isFinite(v);
 if (typeof v !== "object" || seen.has(v)) return false;
 seen.add(v);
 const ok = Array.isArray(v) ? Array.from(v).every(x => valid(x, seen)) : Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(x => valid(x, seen));
 seen.delete(v); return ok;
}
for (const c of requests) {
 let mod;
 try { mod = await import("./" + c.modulePath); }
 catch { results.push({caseId:c.caseId,kind:"invalid"}); continue; }
 try {
  const value = await mod[c.exportName](...c.args);
  results.push(valid(value) ? {caseId:c.caseId,kind:"return",value} : {caseId:c.caseId,kind:"invalid"});
 } catch (e) { results.push({caseId:c.caseId,kind:"throw",name:typeof e?.name === "string" ? e.name : "Error"}); }
}
write(stringify(results));
`;
