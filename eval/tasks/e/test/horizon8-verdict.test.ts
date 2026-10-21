import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmPort, LlmRequest } from "../../../../src/contracts/index.ts";
import {
	counterexampleShapeError,
	runCounterexample,
} from "../../../tools/counterexample.ts";
import { tasks } from "../../index.ts";
import { loadSecret } from "../discovery.ts";
import { horizon8Tasks } from "../horizon-verdict.ts";
import type { ProofVerdict } from "../proof-grader.ts";
import { VERDICT_FAIL, VERDICT_PASS } from "../verdict.ts";

const signal = AbortSignal.timeout(60_000);
const find = (id: string) => horizon8Tasks.find((t) => t.id === id)!;
const proof =
	"主張を示す。$a$ と $b$ について $a+b$ を考える。\n\n$$x^2 \\ge 0$$\n";

/** Fixture truths and rubrics only; the real ones live outside the repository. */
function dirs(truth: boolean) {
	const secretDir = mkdtempSync(join(tmpdir(), "hz8-secrets-"));
	const rubricDir = mkdtempSync(join(tmpdir(), "hz8-rubrics-"));
	for (const t of horizon8Tasks) {
		writeFileSync(
			join(secretDir, `${t.id}.json`),
			JSON.stringify({ id: t.id, kind: "verdict", truth }),
		);
		writeFileSync(
			join(rubricDir, `${t.id}.json`),
			JSON.stringify({
				id: t.id,
				threshold: 0.8,
				checkpoints: [
					{ id: "a", weight: 1, text: "a" },
					{ id: "b", weight: 1, text: "b" },
					{ id: "c", weight: 1, text: "c" },
					{ id: "d", weight: 1, text: "d" },
				],
				fatal: [{ id: "circular", text: "循環" }],
			}),
		);
	}
	return { secretDir, rubricDir };
}

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

async function run(
	id: string,
	opts: {
		truth: boolean;
		verdict?: string;
		proof?: string;
		counterexample?: string;
		graderPass?: boolean;
	},
) {
	const work = mkdtempSync(join(tmpdir(), "hz8-task-"));
	const { secretDir, rubricDir } = dirs(opts.truth);
	const grader = fakeGrader(opts.graderPass ?? true);
	try {
		const instance = await find(id).create(work, {
			grader: grader.llm,
			toolTier: 0,
			secretDir,
			rubricDir,
		});
		const invoke = (tool: string, input: Record<string, unknown>) =>
			instance.tools.invoke({ tool, input: input as never }, signal);
		const statuses: string[] = [];
		if (opts.verdict !== undefined)
			statuses.push(
				(await invoke("submit_verdict", { verdict: opts.verdict })).status,
			);
		if (opts.proof !== undefined)
			statuses.push(
				(await invoke("write_proof", { content: opts.proof })).status,
			);
		if (opts.counterexample !== undefined)
			statuses.push(
				(await invoke("submit_counterexample", { data: opts.counterexample }))
					.status,
			);
		const [c] = await instance.acceptance.verify(signal);
		return {
			statuses,
			passed: c!.passed,
			evidence: c!.evidence,
			graderCalls: grader.seen.length,
			prompt: String(grader.seen[0]?.prompt ?? ""),
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
		rmSync(secretDir, { recursive: true, force: true });
		rmSync(rubricDir, { recursive: true, force: true });
	}
}

describe("horizon-8 hidden-truth tasks", () => {
	test("five tasks registered with secret and rubric ids, uniform rubric size", () => {
		expect(horizon8Tasks.length).toBe(5);
		for (const t of horizon8Tasks) {
			expect(tasks).toContain(t);
			expect(t.secretId).toBe(t.id);
			expect(t.rubricId).toBe(t.id);
			expect(t.rubricSize).toBe(4);
			expect(t.acceptance.map((a) => a.id)).toEqual(["decided-and-justified"]);
		}
	});

	test("goals are phrased the same way for every task and name both routes", () => {
		const opening =
			"次の主張が正しいかどうかを判定し、正しければ証明し、正しくなければ反例を挙げよ。";
		const strip = (g: string) =>
			g
				.split("\n")
				.filter(
					(l) => !l.startsWith("【主張】") && !l.startsWith("false と判定"),
				);
		const shapes = horizon8Tasks.map((t) => strip(t.goalFor!(0)).join("\n"));
		for (const t of horizon8Tasks) {
			expect(t.goal).toContain(opening);
			expect(t.goal).toContain("submit_verdict");
			expect(t.goal).toContain("write_proof");
			expect(t.goal).toContain("submit_counterexample");
			// Nothing in the visible text hints at the answer.
			expect(t.goal).not.toMatch(/偽である|真である|成り立たない|反例が存在/);
			expect(JSON.stringify(t.traps)).toBe(
				JSON.stringify(horizon8Tasks[0]!.traps),
			);
		}
		expect(new Set(shapes).size).toBe(1);
	});

	test("a wrong verdict fails with the same evidence as a rejected justification", async () => {
		const id = "hz8-gcd-cauchy-form";
		const wrongTrue = await run(id, { truth: false, verdict: "true", proof });
		const badProof = await run(id, {
			truth: true,
			verdict: "true",
			proof,
			graderPass: false,
		});
		const wrongFalse = await run(id, {
			truth: true,
			verdict: "false",
			counterexample: "1, -2, 3",
		});
		const badCounter = await run(id, {
			truth: false,
			verdict: "false",
			counterexample: "1, -2, 3",
		});
		for (const r of [wrongTrue, badProof, wrongFalse, badCounter])
			expect(r).toMatchObject({ passed: false, evidence: VERDICT_FAIL });
		// The grader is asked for every "true" claim, right or wrong (same timing).
		expect(wrongTrue.graderCalls).toBe(1);
		expect(badProof.graderCalls).toBe(1);
		expect(wrongFalse.graderCalls).toBe(0);
	});

	test("true verdict passes only if the statement is true and the grader passes", async () => {
		const id = "hz8-real-tournament-rank";
		const r = await run(id, { truth: true, verdict: "true", proof });
		expect(r).toMatchObject({
			passed: true,
			evidence: VERDICT_PASS,
			graderCalls: 1,
		});
		expect(r.prompt).toContain("【主張】");
		expect(r.prompt).toContain("<<<SUBMISSION");
		expect(
			(await run(id, { truth: false, verdict: "true", proof })).passed,
		).toBe(false);
	});

	test("false verdict passes only with a counterexample the checker accepts", async () => {
		// The F_3 checker on a fixture truth of false: a 3 × 3 cyclic tournament has full rank.
		const id = "hz8-tournament-rank-f3";
		const r = await run(id, {
			truth: false,
			verdict: "false",
			counterexample: "010\n001\n100",
		});
		expect(r).toMatchObject({
			passed: false,
			evidence: VERDICT_FAIL,
			graderCalls: 0,
		});
	});

	test("missing pieces are reported from the submission alone", async () => {
		const id = "hz8-cyclic-three";
		for (const truth of [true, false]) {
			expect((await run(id, { truth })).evidence).toBe("判定が未提出");
			expect((await run(id, { truth, verdict: "true" })).evidence).toBe(
				"証明が未提出",
			);
			expect((await run(id, { truth, verdict: "false" })).evidence).toBe(
				"反例が未提出",
			);
			expect(
				(await run(id, { truth, verdict: "true", proof: "式なし" })).evidence,
			).toContain("TeX");
		}
	});

	test("submission tools check shape only", async () => {
		const r = await run("hz8-gcd-quintic-shift", {
			truth: false,
			verdict: "maybe",
			counterexample: "12a",
		});
		expect(r.statuses).toEqual(["error", "error"]);
		expect(counterexampleShapeError("7", { type: "integer" })).toBeNull();
		expect(counterexampleShapeError("0", { type: "integer" })).not.toBeNull();
		const rats = { type: "rationals", minN: 4, maxN: 200 } as const;
		expect(counterexampleShapeError("1, 2, 3/2, 5", rats)).toBeNull();
		expect(counterexampleShapeError("1, 2, 3", rats)).not.toBeNull();
		expect(counterexampleShapeError("1, 2, 3/0, 5", rats)).not.toBeNull();
		expect(counterexampleShapeError("1, 2, x, 5", rats)).not.toBeNull();
		const bin = { type: "binary-matrix", minN: 2, maxN: 40 } as const;
		expect(counterexampleShapeError("01\n00", bin)).toBeNull();
		expect(counterexampleShapeError("012\n000\n100", bin)).not.toBeNull();
		const mat = { type: "rational-matrix", minN: 2, maxN: 30 } as const;
		expect(counterexampleShapeError("0 1/2\n1/2, 0", mat)).toBeNull();
		expect(counterexampleShapeError("0 1\n1", mat)).not.toBeNull();
	});

	test("secret schema accepts verdict secrets", async () => {
		const { secretDir } = dirs(true);
		const s = await loadSecret(secretDir, "hz8-cyclic-three");
		expect(s).toEqual({ id: "hz8-cyclic-three", kind: "verdict", truth: true });
		rmSync(secretDir, { recursive: true, force: true });
	});
});

describe("counterexample checker", () => {
	test("gcd-shift: decided by the gcd (fixture parameters)", async () => {
		// gcd(n^2 + 3, (n+1)^2 + 3) = 13 at n = 6, 1 at n = 5.
		const rule = { name: "gcd-shift", a: 2, b: 3 } as const;
		expect((await runCounterexample({ rule, data: "6" })).ok).toBe(true);
		expect((await runCounterexample({ rule, data: "5" })).ok).toBe(false);
	});

	test("cyclic-ratio: exact rational sum against the bound", async () => {
		// Σ x_i / x_{i+1} ≥ n (AM–GM): never below n; below 2n always.
		const base = {
			name: "cyclic-ratio",
			num: [0],
			den: [[1, 1]],
			minN: 4,
			maxN: 10,
		};
		expect(
			(
				await runCounterexample({
					rule: { ...base, bound: "1" } as never,
					data: "1, 2, 3, 4",
				})
			).ok,
		).toBe(false);
		expect(
			(
				await runCounterexample({
					rule: { ...base, bound: "2" } as never,
					data: "1, 1, 1, 1",
				})
			).ok,
		).toBe(true);
		expect(
			(
				await runCounterexample({
					rule: { ...base, bound: "2" } as never,
					data: "1, -1, 1, 1",
				})
			).ok,
		).toBe(false);
	});

	test("tournament-rank: tournament shape and rank over F_p", async () => {
		const rule = { name: "tournament-rank", p: 2, minN: 2, maxN: 40 } as const;
		// Not a tournament.
		expect((await runCounterexample({ rule, data: "011\n001\n100" })).ok).toBe(
			false,
		);
		// Transitive 3-tournament: rank 2 = n − 1 over every field.
		expect((await runCounterexample({ rule, data: "011\n001\n000" })).ok).toBe(
			false,
		);
		// Over F_2 a rank-deficient tournament exists already at n = 5 (fixture from exhaustive search).
		const r = await runCounterexample({
			rule,
			data: "00000\n10001\n11000\n11101\n10100",
		});
		expect(r.ok).toBe(true);
		// The same matrix has rank 4 = n − 1 over F_5.
		expect(
			(
				await runCounterexample({
					rule: { ...rule, p: 5 },
					data: "00000\n10001\n11000\n11101\n10100",
				})
			).ok,
		).toBe(false);
	});

	test("skew-rank: needs A + A^T = J − I and rank ≤ n − 2 over Q", async () => {
		const rule = { name: "skew-rank", minN: 2, maxN: 30 } as const;
		expect(
			(await runCounterexample({ rule, data: "0 1 1\n0 0 1\n0 0 0" })).ok,
		).toBe(false);
		expect((await runCounterexample({ rule, data: "0 1\n1 0" })).ok).toBe(
			false,
		);
	});

	test("gcd-form: exact quadratic form", async () => {
		const rule = { name: "gcd-form", minN: 1, maxN: 200 } as const;
		expect((await runCounterexample({ rule, data: "1, -2, 3" })).ok).toBe(
			false,
		);
		expect((await runCounterexample({ rule, data: "1, x" })).reason).toContain(
			"形式",
		);
	});
});
