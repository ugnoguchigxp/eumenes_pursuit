import { expect, test } from "bun:test";
import { createAdversarialGrader } from "../tasks/e/adversarial.ts";

// spec/fixes-2026-10-22-g.md §2: rubric grading is labelled "grade", not "review".
test("the rubric grader asks with purpose grade", async () => {
	const seen: string[] = [];
	const llm = {
		complete: async (r: { purpose: string }) => {
			seen.push(r.purpose);
			throw new Error("stop");
		},
	} as any;
	const grade = createAdversarialGrader(llm);
	await expect(
		grade({
			question: "q",
			rubric: {
				checkpoints: [{ id: "a", weight: 1, text: "t" }],
				fatal: [],
			} as any,
			report: "r",
			answer: "a",
			signal: AbortSignal.timeout(1000),
		}),
	).rejects.toThrow("stop");
	expect(seen).toEqual(["grade"]);
});
