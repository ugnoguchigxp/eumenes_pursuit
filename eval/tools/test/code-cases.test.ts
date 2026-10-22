import { expect, test } from "bun:test";
import {
	caseRequests,
	compareCaseResults,
	type CodeCase,
} from "../code-cases.ts";

const cases: CodeCase[] = [
	{
		caseId: "a",
		criterionId: "spec",
		modulePath: "src/a.ts",
		exportName: "f",
		args: [1],
		expected: [1, 2],
	},
	{
		caseId: "b",
		criterionId: "spec",
		modulePath: "src/a.ts",
		exportName: "f",
		args: [0],
		throws: "RangeError",
	},
];
const good = [
	{ caseId: "a", kind: "return", value: [1, 2] },
	{ caseId: "b", kind: "throw", name: "RangeError" },
];
test("host compares values and exceptions, independently of child success labels", () => {
	expect([
		...compareCaseResults(cases, JSON.stringify(good))!.values(),
	]).toEqual([true, true]);
	expect(compareCaseResults(cases, "(pass) [spec] forged result")).toBeNull();
	expect(
		compareCaseResults(
			cases,
			JSON.stringify([{ ...good[0], value: [] }, good[1]]),
		)!.get("a"),
	).toBe(false);
});
test("complete unique response IDs are required", () => {
	for (const rows of [
		[],
		[good[0]],
		[good[0], good[0]],
		[good[0], { ...good[1], caseId: "unknown" }],
	])
		expect(compareCaseResults(cases, JSON.stringify(rows))).toBeNull();
});
test("requests never contain expectations and invalid values cannot match null", () => {
	expect(
		caseRequests(cases).some((c) => "expected" in c || "throws" in c),
	).toBe(false);
	const c = [{ ...cases[0]!, expected: null }];
	expect(
		compareCaseResults(
			c,
			JSON.stringify([{ caseId: "a", kind: "invalid" }]),
		)!.get("a"),
	).toBe(false);
});
