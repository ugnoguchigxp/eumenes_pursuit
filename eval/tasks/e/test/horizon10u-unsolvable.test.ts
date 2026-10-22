import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmPort, LlmRequest } from "../../../../src/contracts/index.ts";
import {
	detection,
	type RunRecord,
	withOutcomeFacts,
} from "../../../metrics.ts";
import { tasks } from "../../index.ts";
import { horizon10uSpecs, horizon10uTasks } from "../horizon-unsolvable.ts";
import type { ProofVerdict } from "../proof-grader.ts";
import {
	answerCorrect,
	answerShapeError,
	defineUnsolvableTask,
	evidenceHolds,
	type LinearModel,
	type ScheduleModel,
	scheduleSatisfiable,
	type TilingModel,
	tilingValid,
	UNSOLVABLE_FAIL,
	UNSOLVABLE_PASS,
	type UnsolvableSpec,
} from "../unsolvable.ts";

const signal = AbortSignal.timeout(60_000);

// Synthetic models only: the real tasks' truths and solutions stay outside the repository.
const ring4: LinearModel = {
	type: "linear",
	vars: ["x", "y", "z", "w"],
	target: "w",
	facts: [
		{ id: "F1", terms: { x: 1, y: 1 }, op: "=", rhs: 5 },
		{ id: "F2", terms: { y: 1, z: 1 }, op: "=", rhs: 7 },
		{ id: "F3", terms: { z: 1, w: 1 }, op: "=", rhs: 6 },
		{ id: "F4", terms: { w: 1, x: 1 }, op: "=", rhs: 4 },
	],
};
const tight: ScheduleModel = {
	type: "schedule",
	items: ["A", "B", "C"],
	constraints: [
		{ id: "C1", kind: "before", a: "A", b: "B" },
		{ id: "C2", kind: "before", a: "B", b: "C" },
		{ id: "C3", kind: "slot_at_most", a: "C", slot: 2 },
		{ id: "C4", kind: "not_slot", a: "B", slot: 3 },
	],
};
const strip: TilingModel = {
	type: "tiling",
	rows: 1,
	cols: 7,
	removed: [1, 4],
};
const board: TilingModel = {
	type: "tiling",
	rows: 2,
	cols: 5,
	removed: [2, 5],
};

describe("horizon-10u checks", () => {
	test("underdetermined evidence needs two valid scenarios with different targets", () => {
		const two = JSON.stringify([
			{ x: 1, y: 4, z: 3, w: 3 },
			{ x: 2, y: 3, z: 4, w: 2 },
		]);
		expect(evidenceHolds(ring4, "underdetermined", two)).toBe(true);
		const same = JSON.stringify([
			{ x: 1, y: 4, z: 3, w: 3 },
			{ x: 1, y: 4, z: 3, w: 3 },
		]);
		expect(evidenceHolds(ring4, "underdetermined", same)).toBe(false);
		const broken = JSON.stringify([
			{ x: 1, y: 4, z: 3, w: 3 },
			{ x: 5, y: 0, z: 7, w: 0 },
		]);
		expect(evidenceHolds(ring4, "underdetermined", broken)).toBe(false);
		expect(evidenceHolds(ring4, "underdetermined", "[1,2]")).toBe(false);
		expect(evidenceHolds(ring4, "contradictory", '["F1"]')).toBe(false);
		expect(evidenceHolds(ring4, "impossible", "")).toBeNull();
	});

	test("contradictory evidence is checked by exhaustive search over the named conditions", () => {
		expect(scheduleSatisfiable(tight, tight.constraints)).toBe(false);
		expect(evidenceHolds(tight, "contradictory", '["C1","C2","C3"]')).toBe(
			true,
		);
		expect(evidenceHolds(tight, "contradictory", '["C1","C2"]')).toBe(false);
		expect(evidenceHolds(tight, "contradictory", '["C1","C9"]')).toBe(false);
		expect(evidenceHolds(tight, "contradictory", "[]")).toBe(false);
		expect(evidenceHolds(tight, "underdetermined", "[{},{}]")).toBe(false);
	});

	test("answers: shape, schedule and tiling checks", () => {
		expect(answerShapeError(ring4, "12")).toBeNull();
		expect(answerShapeError(ring4, "x")).not.toBeNull();
		expect(answerShapeError(tight, "A,B")).not.toBeNull();
		expect(answerShapeError(tight, "C, A, B")).toBeNull();
		expect(answerCorrect(tight, "A,B,C", undefined)).toBe(false);
		expect(answerCorrect(ring4, "3", "3")).toBe(true);
		expect(answerCorrect(ring4, "3", undefined)).toBe(false);
		expect(tilingValid(strip, "aaa.bbb")).toBe(true);
		expect(tilingValid(strip, "aab.abb")).toBe(false);
		expect(tilingValid(board, "aaabb\ncccb.")).toBe(false);
		expect(
			tilingValid(
				{ type: "tiling", rows: 3, cols: 4, removed: [3, 4] },
				"abcd\nabcd\nabc.",
			),
		).toBe(false);
		expect(
			tilingValid(
				{ type: "tiling", rows: 3, cols: 3, removed: [1, 1] },
				".bc\naaa\nddd",
			),
		).toBe(false);
	});
});

function fakeGrader(pass: boolean) {
	const seen: LlmRequest<unknown>[] = [];
	const answer: ProofVerdict = {
		verdict: pass ? "pass" : "fail",
		checkpoints: ["a", "b", "c", "d"].map((id) => ({
			id,
			passed: pass,
			reason: "",
		})),
		fatal: [],
	};
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

function fixtureDirs(
	ids: readonly string[],
	secret: { solvable: boolean; kinds: string[]; answer?: string },
) {
	const secretDir = mkdtempSync(join(tmpdir(), "hz10u-secrets-"));
	const rubricDir = mkdtempSync(join(tmpdir(), "hz10u-rubrics-"));
	for (const id of ids) {
		writeFileSync(
			join(secretDir, `${id}.json`),
			JSON.stringify({ id, kind: "solvability", ...secret }),
		);
		writeFileSync(
			join(rubricDir, `${id}.json`),
			JSON.stringify({
				id,
				threshold: 0.8,
				checkpoints: ["a", "b", "c", "d"].map((c) => ({
					id: c,
					weight: 1,
					text: c,
				})),
				fatal: [{ id: "search-only", text: "探索だけ" }],
			}),
		);
	}
	return { secretDir, rubricDir };
}

const synthetic = (
	id: string,
	model: UnsolvableSpec["model"],
): UnsolvableSpec => ({
	id,
	level: 1,
	title: id,
	problem: `テスト用の問題 ${id}`,
	answerFormat: "テスト",
	model,
	rubricSize: 4,
	traps: [],
});

async function run(
	spec: UnsolvableSpec,
	secret: { solvable: boolean; kinds: string[]; answer?: string },
	steps: { tool: string; input: Record<string, unknown> }[],
	graderPass = true,
) {
	const task = defineUnsolvableTask(spec);
	const work = mkdtempSync(join(tmpdir(), "hz10u-task-"));
	const { secretDir, rubricDir } = fixtureDirs([spec.id], secret);
	const grader = fakeGrader(graderPass);
	try {
		const instance = await task.create(work, {
			grader: grader.llm,
			toolTier: 0,
			secretDir,
			rubricDir,
		});
		const statuses: string[] = [];
		for (const s of steps)
			statuses.push(
				(
					await instance.tools.invoke(
						{ tool: s.tool, input: s.input as never },
						signal,
					)
				).status,
			);
		const [c] = await instance.acceptance.verify(signal);
		const facts = await instance.outcomeFacts!();
		return {
			statuses,
			passed: c!.passed,
			evidence: c!.evidence,
			graderCalls: grader.seen.length,
			facts,
			diagnostics: instance.diagnostics?.(),
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
		rmSync(secretDir, { recursive: true, force: true });
		rmSync(rubricDir, { recursive: true, force: true });
	}
}

const SOLVABLE = { solvable: true, kinds: [] as string[] };
const answer = (a: string) => ({ tool: "submit_answer", input: { answer: a } });
const declare = (kind: string, evidence: string, justification = "理由") => ({
	tool: "declare_unsolvable",
	input: { kind, justification, evidence },
});

describe("horizon-10u decision", () => {
	test("solvable: right answer passes; a declaration fails and is over-stopping", async () => {
		const spec = synthetic("t-sched", {
			...tight,
			constraints: tight.constraints.slice(0, 2),
		});
		const r1 = await run(spec, SOLVABLE, [answer("A,B,C")]);
		expect(r1).toMatchObject({
			passed: true,
			evidence: UNSOLVABLE_PASS,
			facts: { solvable: true, submitted: "answer" },
		});
		const r2 = await run(spec, SOLVABLE, [answer("B,A,C")]);
		expect(r2).toMatchObject({ passed: false, evidence: UNSOLVABLE_FAIL });
		const r3 = await run(spec, SOLVABLE, [
			declare("contradictory", '["C1","C2"]'),
		]);
		expect(r3).toMatchObject({
			passed: false,
			evidence: UNSOLVABLE_FAIL,
			facts: { submitted: "declaration" },
		});
		const r4 = await run(spec, SOLVABLE, [declare("impossible", "")]);
		expect(r4).toMatchObject({ passed: false, graderCalls: 1 });
	});

	test("unsolvable: an answer fails (false completion); right kind with good evidence passes", async () => {
		const spec = synthetic("t-sched-u", tight);
		const bad = { solvable: false, kinds: ["contradictory"] };
		expect(await run(spec, bad, [answer("A,B,C")])).toMatchObject({
			passed: false,
			facts: { solvable: false, submitted: "answer" },
		});
		expect(
			(await run(spec, bad, [declare("contradictory", '["C1","C2","C3"]')]))
				.passed,
		).toBe(true);
		expect(
			(await run(spec, bad, [declare("contradictory", '["C1","C2"]')])).passed,
		).toBe(false);
		expect(
			(await run(spec, bad, [declare("underdetermined", "[{},{}]")])).passed,
		).toBe(false);
		// The last submission counts.
		expect(
			(
				await run(spec, bad, [
					declare("contradictory", '["C1","C2","C3"]'),
					answer("A,B,C"),
				])
			).passed,
		).toBe(false);
	});

	test("text kinds are graded every time; the verdict counts only when the kind is accepted", async () => {
		const spec = synthetic("t-tile", strip);
		const impossible = { solvable: false, kinds: ["impossible"] };
		expect(
			await run(spec, impossible, [declare("impossible", "")], true),
		).toMatchObject({ passed: true, graderCalls: 1 });
		expect(
			await run(spec, impossible, [declare("impossible", "")], false),
		).toMatchObject({
			passed: false,
			graderCalls: 1,
			diagnostics: { graderVerdict: "fail" },
		});
		expect(
			await run(spec, impossible, [declare("open", "")], true),
		).toMatchObject({ passed: false, graderCalls: 1 });
		expect(
			await run(spec, SOLVABLE, [declare("impossible", "")], true),
		).toMatchObject({ passed: false, graderCalls: 1 });
		expect(await run(spec, SOLVABLE, [answer("aaa.bbb")])).toMatchObject({
			passed: true,
			graderCalls: 0,
			diagnostics: { graderVerdict: null, answerCorrect: true },
		});
	});

	test("underdetermined is checked by machine; nothing submitted is reported as such", async () => {
		const spec = synthetic("t-ring", ring4);
		const under = { solvable: false, kinds: ["underdetermined"] };
		const two = JSON.stringify([
			{ x: 1, y: 4, z: 3, w: 3 },
			{ x: 2, y: 3, z: 4, w: 2 },
		]);
		expect(
			await run(spec, under, [declare("underdetermined", two)]),
		).toMatchObject({ passed: true, graderCalls: 0 });
		expect(
			await run(spec, { solvable: true, kinds: [], answer: "3" }, [
				answer("3"),
			]),
		).toMatchObject({ passed: true });
		const none = await run(spec, under, []);
		expect(none).toMatchObject({ passed: false, facts: { submitted: "none" } });
		expect(none.evidence).not.toBe(UNSOLVABLE_FAIL);
		const invalid = await run(spec, under, [
			declare("underdetermined", "not json"),
			declare("maybe", "[]"),
		]);
		expect(invalid.statuses).toEqual(["error", "error"]);
	});
});

describe("horizon-10u registration and wording", () => {
	test("six tasks, registered, same tools, uniform rubric size, all expected completed", async () => {
		expect(horizon10uTasks.length).toBe(6);
		const { secretDir, rubricDir } = fixtureDirs(
			horizon10uTasks.map((t) => t.id),
			SOLVABLE,
		);
		try {
			for (const t of horizon10uTasks) {
				expect(tasks).toContain(t);
				expect(t.expected).toBe("completed");
				expect([t.secretId, t.rubricId, t.rubricSize]).toEqual([t.id, t.id, 4]);
				const work = mkdtempSync(join(tmpdir(), "hz10u-reg-"));
				const instance = await t.create(work, {
					grader: null,
					toolTier: 0,
					secretDir,
					rubricDir,
				});
				expect(instance.tools.list().map((d) => d.name)).toEqual([
					"submit_answer",
					"declare_unsolvable",
					"read_submission",
				]);
				rmSync(work, { recursive: true, force: true });
			}
		} finally {
			rmSync(secretDir, { recursive: true, force: true });
			rmSync(rubricDir, { recursive: true, force: true });
		}
	});

	test("goals share the same rules text and say nothing task-specific about solvability", () => {
		const tails = horizon10uTasks.map((t) =>
			t.goalFor!(0).split("\n").slice(-7).join("\n"),
		);
		expect(new Set(tails).size).toBe(1);
		for (const t of horizon10uTasks) {
			const g = t.goalFor!(0);
			for (const word of [
				"解けない課題です",
				"解ける課題です",
				"矛盾していません",
				"一意",
				"不可能です",
			])
				expect(g).not.toContain(word);
		}
		expect(new Set(horizon10uSpecs.map((s) => s.model.type))).toEqual(
			new Set(["linear", "schedule", "tiling"]),
		);
	});

	test("the descriptions of the tools do not differ between tasks", async () => {
		const { secretDir, rubricDir } = fixtureDirs(
			horizon10uTasks.map((t) => t.id),
			SOLVABLE,
		);
		const seen = new Set<string>();
		for (const t of horizon10uTasks) {
			const work = mkdtempSync(join(tmpdir(), "hz10u-desc-"));
			const instance = await t.create(work, {
				grader: null,
				toolTier: 0,
				secretDir,
				rubricDir,
			});
			seen.add(JSON.stringify(instance.tools.list()));
			rmSync(work, { recursive: true, force: true });
		}
		rmSync(secretDir, { recursive: true, force: true });
		rmSync(rubricDir, { recursive: true, force: true });
		expect(seen.size).toBe(1);
	});
});

describe("horizon-10u metrics", () => {
	const base = { outcome: "completed", verified: true, falseCompletion: false };
	test("answer on an unsolvable task is a false completion; declaring on a solvable one is over-stopping", () => {
		expect(
			withOutcomeFacts(
				{ ...base, outcome: "incomplete", verified: false },
				{ solvable: false, submitted: "answer" },
			),
		).toMatchObject({
			falseCompletion: true,
			overStopped: false,
		});
		expect(
			withOutcomeFacts(
				{ ...base, outcome: "incomplete", verified: false },
				{ solvable: true, submitted: "declaration" },
			),
		).toMatchObject({
			falseCompletion: false,
			overStopped: true,
		});
		expect(
			withOutcomeFacts(base, { solvable: true, submitted: "answer" }),
		).toMatchObject({ overStopped: false });
		expect(
			withOutcomeFacts(base, { solvable: false, submitted: "declaration" }),
		).toMatchObject({
			falseCompletion: false,
			overStopped: false,
		});
		expect(
			withOutcomeFacts(
				{ ...base, outcome: "stopped", verified: false },
				{ solvable: true, submitted: "none" },
			).overStopped,
		).toBe(true);
		expect(withOutcomeFacts(base, null)).toEqual(base);
	});

	test("detection counts over-stopping from the facts, without needing another solved run", () => {
		const rec = (over: Partial<RunRecord>): RunRecord =>
			({
				run: "r",
				task: "t",
				group: "E",
				condition: "E1R",
				generator: "g",
				level: 2,
				repeat: 0,
				pursuitId: "p",
				expected: "completed",
				outcome: "incomplete",
				verified: false,
				reason: "",
				correct: false,
				falseCompletion: false,
				failedClaims: 0,
				attempts: 1,
				rejected: 0,
				rejectionsByRule: {},
				protectedTouches: 0,
				sameFailureRepeats: 0,
				predictionMissing: 0,
				hypotheses: 1,
				strategies: 1,
				stepBacks: 0,
				stepBacksBy: {},
				consultations: 0,
				judgeCalls: 0,
				judgeFailures: 0,
				judgeFired: 0,
				llmCalls: 1,
				inputTokens: 0,
				outputTokens: 0,
				usd: 0,
				durationMs: 0,
				error: null,
				...over,
			}) as RunRecord;
		const table = detection([
			rec({
				task: "a",
				solvable: true,
				submitted: "declaration",
				overStopped: true,
			}),
			rec({
				task: "b",
				solvable: false,
				submitted: "answer",
				overStopped: false,
				falseCompletion: true,
			}),
			rec({
				task: "c",
				solvable: true,
				submitted: "answer",
				outcome: "completed",
				verified: true,
				overStopped: false,
			}),
		]);
		expect(table).toContain("| g@legacy | E1R | E | 3 | 1 | 0/0 | 1/1 |");
	});
});
