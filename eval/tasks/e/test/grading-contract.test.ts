import { expect, test } from "bun:test";
import type { LlmPort, LlmRequest } from "../../../../src/contracts/index.ts";
import {
	decideProof,
	createProofGrader,
	type ProofRubric,
	type ProofVerdict,
} from "../proof-grader.ts";
import { createGrader } from "../grader.ts";
import { GradingContractError } from "../grading-contract.ts";
const rubric: ProofRubric = {
	id: "test",
	threshold: 0.8,
	checkpoints: [
		{ id: "a", weight: 8, text: "a" },
		{ id: "b", weight: 2, text: "b" },
	],
	fatal: [{ id: "circular", text: "no circularity" }],
};
const row = (id: string, passed = true) => ({ id, passed, reason: "r" });
const verdict: ProofVerdict = {
	verdict: "pass",
	checkpoints: [row("a"), row("b", false)],
	fatal: [],
};
test("complete weighted grading preserves thresholds; malformed IDs never pass", () => {
	expect(decideProof(rubric, verdict)).toMatchObject({
		pass: true,
		score: 0.8,
	});
	for (const checkpoints of [
		[row("a")],
		[row("a"), row("a", false), row("b")],
		[row("a", false), row("a"), row("b")],
		[row("a"), row("unknown")],
	])
		expect(decideProof(rubric, { ...verdict, checkpoints })).toMatchObject({
			pass: false,
			contractIssue: "grading_response_invalid",
		});
	expect(
		decideProof(rubric, {
			...verdict,
			checkpoints: [...verdict.checkpoints].reverse(),
		}).score,
	).toBe(0.8);
	expect(
		decideProof(rubric, { ...verdict, fatal: [{ id: "unknown", reason: "r" }] })
			.pass,
	).toBe(false);
});
function fake(answer: unknown) {
	const requests: LlmRequest<unknown>[] = [];
	const llm: LlmPort = {
		async complete(request) {
			requests.push(request);
			return {
				value: request.schema.parse(answer),
				model: "fake",
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	return { llm, requests };
}
test("invalid grading is not cached; rubric content is part of cache identity", async () => {
	const f = fake({ ...verdict, checkpoints: [row("a"), row("a"), row("b")] });
	const grade = createProofGrader(f.llm);
	const input = {
		statement: "s",
		rubric,
		proof: "p",
		signal: new AbortController().signal,
	};
	for (let i = 0; i < 2; i++)
		await expect(grade(input)).rejects.toBeInstanceOf(GradingContractError);
	expect(f.requests).toHaveLength(2);
	const good = fake(verdict);
	const validGrade = createProofGrader(good.llm);
	await validGrade(input);
	await validGrade(input);
	await validGrade({ ...input, rubric: { ...rubric, notes: "new notes" } });
	expect(good.requests).toHaveLength(2);
});
test("numeric evidence is delivered as approximation, and changes invalidate cache", async () => {
	const f = fake({ items: [row("a")], sound: true, lemmas: [] });
	const grade = createGrader(f.llm);
	const input = {
		statement: "s",
		rubric: [{ id: "a", text: "a" }],
		reference: "ref",
		proof: "proof",
		signal: new AbortController().signal,
	};
	await grade({
		...input,
		checks: [
			{ expression: "sqrt(2)/10^60 = 0", ok: true, assurance: "numeric" },
		],
	});
	expect(f.requests[0]!.system).toContain("does not establish exact equality");
	expect(f.requests[0]!.prompt).toContain('"assurance":"numeric"');
	expect(f.requests[0]!.system).not.toContain("have been verified exactly");
	await grade({
		...input,
		checks: [{ expression: "1/2 + 1/2 = 1", ok: true, assurance: "exact" }],
	});
	expect(f.requests).toHaveLength(2);
});
test("ordinary grader also rejects contradictory, missing, and unknown items", async () => {
	for (const items of [[], [row("a"), row("a", false)], [row("unknown")]]) {
		const f = fake({ items, sound: true, lemmas: [] });
		await expect(
			createGrader(f.llm)({
				statement: "s",
				rubric: [{ id: "a", text: "a" }],
				reference: "",
				proof: "p",
				signal: new AbortController().signal,
			}),
		).rejects.toBeInstanceOf(GradingContractError);
	}
});
