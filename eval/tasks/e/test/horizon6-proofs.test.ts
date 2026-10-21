import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmPort, LlmRequest } from "../../../../src/contracts/index.ts";
import { createFileLlm } from "../../../../standalone/file-llm.ts";
import { tasks } from "../../index.ts";
import { horizon6Tasks } from "../horizon-proofs.ts";
import {
	decideProof,
	loadRubric,
	proofGraderPrompt,
	proofVerdictSchema,
	type ProofRubric,
	type ProofVerdict,
} from "../proof-grader.ts";

const signal = AbortSignal.timeout(60_000);

/** Fixture only; the real rubrics live outside the repository. */
function fixture(id: string): ProofRubric {
	return {
		id,
		threshold: 0.8,
		notes: "FIXTURE-NOTE",
		checkpoints: [
			{ id: "c1", weight: 5, text: "FIXTURE-CHECKPOINT-ONE" },
			{ id: "c2", weight: 3, text: "FIXTURE-CHECKPOINT-TWO" },
			{ id: "c3", weight: 2, text: "FIXTURE-CHECKPOINT-THREE" },
		],
		fatal: [{ id: "circular", text: "FIXTURE-FATAL" }],
	};
}
const verdict = (
	v: "pass" | "fail",
	passed: string[],
	fatal: string[] = [],
): ProofVerdict => ({
	verdict: v,
	checkpoints: ["c1", "c2", "c3"].map((id) => ({
		id,
		passed: passed.includes(id),
		reason: "r",
	})),
	fatal: fatal.map((id) => ({ id, reason: "r" })),
});

const proof = `証明。$$a^2 \\ge 0$$ と $b = 1$ と $c = 2$ から従う。`;

function rubricDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hz6-rubrics-"));
	for (const t of horizon6Tasks)
		writeFileSync(
			join(dir, `${t.rubricId}.json`),
			JSON.stringify(fixture(t.rubricId!)),
		);
	return dir;
}

function fakeGrader(answer: ProofVerdict) {
	const seen: LlmRequest<unknown>[] = [];
	const llm: LlmPort = {
		async complete<T>(request: LlmRequest<T>) {
			seen.push(request as LlmRequest<unknown>);
			return {
				value: request.schema.parse(answer),
				model: "fake",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				latencyMs: 0,
			};
		},
	};
	return { llm, seen };
}

async function submit(
	id: string,
	context: { grader: LlmPort | null; rubricDir?: string | null },
	text = proof,
) {
	const dir = mkdtempSync(join(tmpdir(), "hz6-task-"));
	const task = horizon6Tasks.find((t) => t.id === id)!;
	const instance = await task.create(dir, { toolTier: 0, ...context });
	const w = await instance.tools.invoke(
		{ tool: "write_proof", input: { content: text } },
		signal,
	);
	expect(w.status).toBe("ok");
	return { instance, dir };
}

describe("horizon-6 proof tasks (hz6-proof-*)", () => {
	test("four registered proof tasks with external rubric ids and no rubric in the repository", () => {
		expect(horizon6Tasks.map((t) => t.id).sort()).toEqual([
			"hz6-proof-alt-euler-7",
			"hz6-proof-binomial-mod-p",
			"hz6-proof-commutator-nilpotent",
			"hz6-proof-discrete-wirtinger",
		]);
		for (const t of horizon6Tasks) {
			expect(tasks).toContain(t);
			expect(t.group).toBe("E");
			expect(t.level).toBe(4);
			expect(t.rubricId).toBe(t.id);
			expect(t.rubricSize).toBe(6);
			expect(t.acceptance.map((a) => a.id)).toEqual([
				"tex-valid",
				"proof-sound",
			]);
		}
	});

	test("the generator sees the statement and tools, never the rubric", async () => {
		const dirs = rubricDir();
		for (const t of horizon6Tasks)
			for (const tier of [0, 1, 2, 3] as const) {
				const dir = mkdtempSync(join(tmpdir(), "hz6-leak-"));
				const instance = await t.create(dir, {
					grader: null,
					toolTier: tier,
					rubricDir: dirs,
				});
				const visible = [
					t.goalFor?.(tier) ?? t.goal,
					...t.acceptance.map((a) => a.text),
					t.consultAnswer,
					JSON.stringify(instance.tools.list()),
				].join("\n");
				expect(visible).toContain("証明せよ");
				for (const s of [
					"FIXTURE",
					"rubric",
					"採点基準",
					dirs,
					"hz_author_private",
				])
					expect(visible).not.toContain(s);
				rmSync(dir, { recursive: true, force: true });
			}
	});

	test("decideProof: pass needs the grader's pass, no fatal error and weight ≥ threshold", () => {
		const r = fixture("x");
		expect(decideProof(r, verdict("pass", ["c1", "c2", "c3"]))).toMatchObject({
			pass: true,
			score: 1,
		});
		// 8/10 = threshold: passes.
		expect(decideProof(r, verdict("pass", ["c1", "c2"])).pass).toBe(true);
		// 7/10 < 0.8.
		expect(decideProof(r, verdict("pass", ["c1", "c3"]))).toMatchObject({
			pass: false,
			failedCheckpoints: ["c2"],
		});
		// Full marks but a fatal error.
		expect(
			decideProof(r, verdict("pass", ["c1", "c2", "c3"], ["circular"])),
		).toMatchObject({ pass: false, fatal: ["circular"] });
		// The grader's own verdict is required.
		expect(decideProof(r, verdict("fail", ["c1", "c2", "c3"])).pass).toBe(
			false,
		);
		// A checkpoint the grader did not mention counts as failed; unknown ids add nothing.
		const partial: ProofVerdict = {
			verdict: "pass",
			checkpoints: [
				{ id: "c1", passed: true, reason: "" },
				{ id: "made-up", passed: true, reason: "" },
			],
			fatal: [],
		};
		expect(decideProof(r, partial)).toMatchObject({
			pass: false,
			failedCheckpoints: ["c2", "c3"],
			score: 0.5,
		});
	});

	test("the verdict schema is strict", () => {
		expect(
			proofVerdictSchema.safeParse({
				verdict: "pass",
				checkpoints: [],
				fatal: [],
			}).success,
		).toBe(true);
		for (const bad of [
			{ verdict: "maybe", checkpoints: [], fatal: [] },
			{ verdict: "pass", checkpoints: [], fatal: [], score: 1 },
			{
				verdict: "pass",
				checkpoints: [{ id: "c1", passed: "yes", reason: "" }],
				fatal: [],
			},
			{ verdict: "pass", checkpoints: [] },
		])
			expect(proofVerdictSchema.safeParse(bad).success).toBe(false);
	});

	test("loadRubric checks the file and its id", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hz6-r-"));
		writeFileSync(join(dir, "a.json"), JSON.stringify(fixture("a")));
		writeFileSync(join(dir, "b.json"), JSON.stringify(fixture("a")));
		writeFileSync(
			join(dir, "c.json"),
			JSON.stringify({ ...fixture("c"), threshold: 2 }),
		);
		expect((await loadRubric(dir, "a")).checkpoints).toHaveLength(3);
		await expect(loadRubric(dir, "b")).rejects.toThrow("rubric_id_mismatch");
		await expect(loadRubric(dir, "c")).rejects.toThrow();
		await expect(loadRubric(dir, "missing")).rejects.toThrow();
		await expect(loadRubric(dir, "../a")).rejects.toThrow("rubric_id_invalid");
	});

	test("the grader prompt holds the statement, rubric and proof only", () => {
		const t = horizon6Tasks[0]!;
		const prompt = proofGraderPrompt({
			statement: "STATEMENT",
			rubric: fixture(t.id),
			proof: "PROOF-TEXT",
		});
		for (const s of [
			"STATEMENT",
			"FIXTURE-CHECKPOINT-ONE",
			"（重み 5）",
			"FIXTURE-FATAL",
			"FIXTURE-NOTE",
			"10 中 8 以上",
			"<<<SUBMISSION\nPROOF-TEXT\nSUBMISSION>>>",
		])
			expect(prompt).toContain(s);
		expect(prompt).not.toContain("想定解");
	});

	test("without a grader or a rubric dir the proof is not passed", async () => {
		const id = "hz6-proof-discrete-wirtinger";
		const a = await submit(id, { grader: null, rubricDir: rubricDir() });
		expect((await a.instance.acceptance.verify(signal)).at(-1)).toMatchObject({
			id: "proof-sound",
			passed: false,
		});
		const { llm, seen } = fakeGrader(verdict("pass", ["c1", "c2", "c3"]));
		const b = await submit(id, { grader: llm, rubricDir: null });
		const r = (await b.instance.acceptance.verify(signal)).at(-1)!;
		expect(r.passed).toBe(false);
		expect(r.evidence).toBe("採点基準がありません");
		expect(seen).toHaveLength(0);
		for (const d of [a.dir, b.dir]) rmSync(d, { recursive: true, force: true });
	});

	test("a pass verdict passes proof-sound; a fatal error fails it with ids only", async () => {
		const dirs = rubricDir();
		const id = "hz6-proof-commutator-nilpotent";
		const good = fakeGrader(verdict("pass", ["c1", "c2", "c3"]));
		const a = await submit(id, { grader: good.llm, rubricDir: dirs });
		const ra = await a.instance.acceptance.verify(signal);
		expect(ra.map((c) => [c.id, c.passed])).toEqual([
			["tex-valid", true],
			["proof-sound", true],
		]);
		expect(ra[1]!.assurance).toBe("model");
		expect(good.seen).toHaveLength(1);
		expect(good.seen[0]!.prompt).toContain("FIXTURE-CHECKPOINT-TWO");
		expect(good.seen[0]!.prompt).toContain(proof);
		// Same proof: cached, no second grader call.
		await a.instance.acceptance.verify(signal);
		expect(good.seen).toHaveLength(1);

		const bad = fakeGrader({
			...verdict("pass", ["c1", "c2", "c3"], ["circular"]),
			checkpoints: [
				{ id: "c1", passed: true, reason: "SECRET-REASON" },
				{ id: "c2", passed: false, reason: "SECRET-REASON" },
				{ id: "c3", passed: true, reason: "SECRET-REASON" },
			],
		});
		const b = await submit(id, { grader: bad.llm, rubricDir: dirs });
		const rb = (await b.instance.acceptance.verify(signal)).at(-1)!;
		expect(rb.passed).toBe(false);
		expect(rb.evidence).toBe("不合格の基準: c2（致命的: circular; 得点 70%）");
		expect(rb.evidence).not.toContain("SECRET");
		for (const d of [a.dir, b.dir]) rmSync(d, { recursive: true, force: true });
	});

	test("the grader can be a file responder in its own directory", async () => {
		const graderDir = mkdtempSync(join(tmpdir(), "hz6-grader-"));
		const grader = createFileLlm({ dir: graderDir, role: "grader", pollMs: 5 });
		const id = "hz6-proof-binomial-mod-p";
		const a = await submit(id, { grader, rubricDir: rubricDir() });
		const pending = a.instance.acceptance.verify(signal);
		let request = "";
		for (let i = 0; i < 400 && !request; i++) {
			request = readdirSync(join(graderDir, "requests"))[0] ?? "";
			if (!request) await Bun.sleep(5);
		}
		const body = JSON.parse(
			readFileSync(join(graderDir, "requests", request), "utf8"),
		);
		expect(body.role).toBe("grader");
		expect(body.prompt).toContain("FIXTURE-CHECKPOINT-ONE");
		expect(body.prompt).toContain(
			horizon6Tasks.find((t) => t.id === id)!.goal.slice(5, 40),
		);
		expect(body.outputSchema.required.sort()).toEqual([
			"checkpoints",
			"fatal",
			"verdict",
		]);
		mkdirSync(join(graderDir, "responses"), { recursive: true });
		writeFileSync(
			join(graderDir, "responses", request),
			JSON.stringify(verdict("pass", ["c1", "c2"])),
		);
		const r = (await pending).at(-1)!;
		expect(r).toMatchObject({ id: "proof-sound", passed: true });
		expect(r.evidence).toBe("合格（得点 80%）");
		rmSync(a.dir, { recursive: true, force: true });
	});
});
