import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoveryExpressionError } from "../../../tools/discovery.ts";
import { tasks } from "../../index.ts";
import { loadSecret } from "../discovery.ts";
import { horizon7Tasks } from "../horizon-discovery.ts";

const signal = AbortSignal.timeout(60_000);
const find = (id: string) => horizon7Tasks.find((t) => t.id === id)!;

/** Fixture answers only (the real ones live outside the repository). */
const fixtures: Record<string, Record<string, unknown>> = {
	"hz7-construct-o1d1-12": { kind: "construction", optimum: 8 },
	"hz7-count-bracelet-13": { kind: "integer", value: "7" },
	"hz7-formula-king2": {
		kind: "formula",
		values: Object.fromEntries(
			Array.from({ length: 12 }, (_, i) => [
				String(i + 1),
				String((i + 1) ** 2 + 1),
			]),
		),
	},
	"hz7-gf-strip-tiling": {
		kind: "series",
		coefficients: [
			"1",
			"1",
			"2",
			"3",
			"5",
			"8",
			"13",
			"21",
			"34",
			"55",
			"89",
			"144",
		],
	},
};

function secretDir(overrides: Record<string, Record<string, unknown>> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "hz7-secrets-"));
	for (const [id, s] of Object.entries({ ...fixtures, ...overrides }))
		writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, ...s }));
	return dir;
}

async function attempt(
	id: string,
	input: Record<string, unknown>,
	dir: string | null = secretDir(),
) {
	const work = mkdtempSync(join(tmpdir(), "hz7-task-"));
	try {
		const instance = await find(id).create(work, {
			grader: null,
			toolTier: 0,
			secretDir: dir,
		});
		const tool = "grid" in input ? "submit_construction" : "submit_answer";
		const r = await instance.tools.invoke(
			{ tool, input: input as never },
			signal,
		);
		const [c] = await instance.acceptance.verify(signal);
		return {
			status: r.status,
			passed: c!.passed,
			evidence: c!.evidence,
			assurance: c!.assurance,
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

/** One 8-cell ring (each mark: one edge-neighbour and one corner-neighbour marked). */
function ringGrid(row = 0, col = 0): string {
	const g = Array.from({ length: 12 }, () => Array(12).fill("."));
	for (const [r, c] of [
		[0, 1],
		[0, 2],
		[1, 0],
		[1, 3],
		[2, 0],
		[2, 3],
		[3, 1],
		[3, 2],
	] as const)
		g[row + r]![col + c] = "#";
	return g.map((r) => r.join("")).join("\n");
}

describe("horizon-7 discovery tasks (hz7-*)", () => {
	test("four registered tasks, answers by external id only", () => {
		expect(horizon7Tasks.map((t) => t.id).sort()).toEqual(
			Object.keys(fixtures).sort(),
		);
		for (const t of horizon7Tasks) {
			expect(tasks).toContain(t);
			expect(t.group).toBe("E");
			expect(t.level).toBe(4);
			expect(t.secretId).toBe(t.id);
			expect(t.acceptance.map((a) => a.id)).toEqual(["answer-correct"]);
		}
	});

	test("the generator sees statement and tools, never the expected answer or where it lives", async () => {
		const dir = secretDir();
		for (const t of horizon7Tasks) {
			const work = mkdtempSync(join(tmpdir(), "hz7-leak-"));
			const instance = await t.create(work, {
				grader: null,
				toolTier: 0,
				secretDir: dir,
			});
			const visible = [
				t.goal,
				...t.acceptance.map((a) => a.text),
				t.consultAnswer,
				JSON.stringify(instance.tools.list()),
			].join("\n");
			expect(visible).toContain("【問題】");
			for (const s of [dir, "secret", "hz_author_private", "optimum"])
				expect(visible).not.toContain(s);
			rmSync(work, { recursive: true, force: true });
		}
	});

	test("expressions are allow-listed per kind", () => {
		expect(discoveryExpressionError("n^2/2 + Mod(n, 4)", "formula")).toBeNull();
		expect(discoveryExpressionError("(1-x)/(1-x-x^2)", "series")).toBeNull();
		expect(discoveryExpressionError("binomial(13,4)*3", "integer")).toBeNull();
		for (const [text, kind] of [
			["__import__('os')", "integer"],
			["x.__class__", "series"],
			["n**2", "formula"],
			["x", "formula"],
			["n", "series"],
			["zeta(3)", "integer"],
			["1;2", "integer"],
			["", "integer"],
			["1+".repeat(300), "integer"],
		] as const)
			expect(discoveryExpressionError(text, kind)).not.toBeNull();
	});

	test("integer: exact equality, non-integers fail", async () => {
		const id = "hz7-count-bracelet-13";
		expect((await attempt(id, { expression: "3+4" })).passed).toBe(true);
		expect((await attempt(id, { expression: "14/2" })).passed).toBe(true);
		expect(await attempt(id, { expression: "8" })).toMatchObject({
			passed: false,
			evidence: "不一致",
		});
		expect(await attempt(id, { expression: "15/2" })).toMatchObject({
			passed: false,
			evidence: "整数になりません",
		});
		expect((await attempt(id, { expression: "x" })).status).toBe("error");
	});

	test("formula: compared at every recorded n; the reason names no value", async () => {
		const id = "hz7-formula-king2";
		expect((await attempt(id, { expression: "n^2 + 1" })).passed).toBe(true);
		expect((await attempt(id, { expression: "floor(n^2 + 3/2)" })).passed).toBe(
			true,
		);
		const wrong = await attempt(id, { expression: "n^2 + 1 + floor(n/12)" });
		expect(wrong).toMatchObject({
			passed: false,
			evidence: "ある n で値が一致しません",
		});
		expect((await attempt(id, { expression: "n^2/2" })).passed).toBe(false);
	});

	test("series: Taylor coefficients of a rational function", async () => {
		const id = "hz7-gf-strip-tiling";
		expect((await attempt(id, { expression: "1/(1-x-x^2)" })).passed).toBe(
			true,
		);
		expect(
			(await attempt(id, { expression: "(1+x)/(1-x^2-x^3-x^2*(1-x)-x)" }))
				.passed,
		).toBe(false);
		expect(
			(await attempt(id, { expression: "1/(1-x-x^2) + x^20" })).passed,
		).toBe(true);
		expect(
			(await attempt(id, { expression: "1/(1-x-x^2) + x^11" })).passed,
		).toBe(false);
		expect((await attempt(id, { expression: "1/x" })).evidence).toBe(
			"x = 0 で正則ではありません",
		);
	});

	test("construction: rule, count and optimum are checked; reasons stay short", async () => {
		const id = "hz7-construct-o1d1-12";
		const ring = ringGrid();
		expect(await attempt(id, { grid: ring, count: 8 })).toMatchObject({
			passed: true,
			assurance: "exact",
		});
		expect(await attempt(id, { grid: ring, count: 9 })).toMatchObject({
			passed: false,
			evidence: "申告した印の数が配置の印の数と違います",
		});
		const broken = ring.replace(".##.", ".###");
		expect((await attempt(id, { grid: broken, count: 9 })).evidence).toMatch(
			/^条件を満たさない印があります（1 行 \d+ 列）$/,
		);
		const notMax = await attempt(
			id,
			{ grid: ring, count: 8 },
			secretDir({ [id]: { kind: "construction", optimum: 16 } }),
		);
		expect(notMax).toMatchObject({
			passed: false,
			evidence: "条件は満たしますが、印の数が最大ではありません",
		});
		expect(notMax.evidence).not.toContain("16");
		expect((await attempt(id, { grid: "#.\n.#", count: 2 })).status).toBe(
			"error",
		);
	});

	test("without a secret dir nothing passes; secrets are validated", async () => {
		expect(
			await attempt("hz7-count-bracelet-13", { expression: "7" }, null),
		).toMatchObject({
			passed: false,
			evidence: "照合用データがありません",
		});
		const dir = mkdtempSync(join(tmpdir(), "hz7-bad-"));
		writeFileSync(
			join(dir, "a.json"),
			JSON.stringify({ id: "b", kind: "integer", value: "1" }),
		);
		writeFileSync(
			join(dir, "c.json"),
			JSON.stringify({ id: "c", kind: "integer", value: 1 }),
		);
		await expect(loadSecret(dir, "a")).rejects.toThrow("secret_id_mismatch");
		await expect(loadSecret(dir, "c")).rejects.toThrow();
		await expect(loadSecret(dir, "../a")).rejects.toThrow("secret_id_invalid");
	});
});
