import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolTier } from "../../../contracts.ts";
import { checkTex, parseChecks } from "../../../tools/math.ts";
import { reasoningTasks } from "../problems.ts";

const signal = AbortSignal.timeout(60_000);
const find = (id: string) => reasoningTasks.find((t) => t.id === id)!;
async function withTask<T>(
	id: string,
	tier: ToolTier,
	run: (
		call: (
			tool: string,
			input?: Record<string, unknown>,
		) => ReturnType<
			import("../../../../src/contracts/index.ts").ToolPort["invoke"]
		>,
		verify: () => ReturnType<
			import("../../../../src/contracts/index.ts").AcceptancePort["verify"]
		>,
		names: string[],
	) => Promise<T>,
) {
	const dir = mkdtempSync(join(tmpdir(), "e-test-"));
	try {
		const instance = await find(id).create(dir, {
			grader: null,
			toolTier: tier,
		});
		return await run(
			(tool, input = {}) =>
				instance.tools.invoke({ tool, input: input as never }, signal),
			() => instance.acceptance.verify(signal),
			instance.tools.list().map((t) => t.name),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const goodPi = `内接正12角形の周長 $L = 6(\\sqrt{6}-\\sqrt{2})$ を使う。
$$2\\pi > L$$ かつ $$L > 6.1$$ より $\\pi > 3.05$。
\`\`\`checks
6*(sqrt(6)-sqrt(2)) > 6.1
2.449^2 < 6
\`\`\`
`;

describe("group E: written reasoning", () => {
	test("ids, levels and tiered goals", () => {
		for (const t of reasoningTasks) {
			expect(t.group).toBe("E");
			expect(t.level).toBeGreaterThanOrEqual(1);
			expect(t.goalFor?.(0)).toContain("計算機も使えません");
			expect(t.goalFor?.(1)).not.toContain("計算機も使えません");
		}
		expect(new Set(reasoningTasks.map((t) => t.level))).toEqual(
			new Set([1, 2, 3, 4]),
		);
	});

	test("tools grow with the tier", async () => {
		const t0 = await withTask(
			"e1-pi-gt-305",
			0,
			async (_c, _v, names) => names,
		);
		const t1 = await withTask(
			"e1-pi-gt-305",
			1,
			async (_c, _v, names) => names,
		);
		const t2 = await withTask(
			"e1-pi-gt-305",
			2,
			async (_c, _v, names) => names,
		);
		expect(t0).toEqual(["write_proof", "read_proof", "check_tex"]);
		expect(t1).toEqual([...t0, "calc"]);
		expect(t2).toEqual([...t1, "search_reference", "read_reference"]);
	});

	test("format criteria pass with valid TeX and true checks; the proof is never passed without a grader", async () => {
		await withTask("e1-pi-gt-305", 0, async (call, verify) => {
			expect((await call("write_proof", { content: goodPi })).status).toBe(
				"ok",
			);
			const r = await verify();
			expect(r.map((c) => [c.id, c.passed])).toEqual([
				["tex-valid", true],
				["checks-true", true],
				["proof-sound", false],
			]);
		});
	});

	test("forbidden names, false claims and bad TeX fail", async () => {
		expect(
			parseChecks("```checks\npi > 3.05\n```", ["pi"]).errors[0],
		).toContain("pi");
		expect(checkTex("$\\frac{1}{2$ と $x$").errors.length).toBe(1);
		await withTask("e1-pi-gt-305", 0, async (call, verify) => {
			await call("write_proof", {
				content: goodPi.replace("sqrt(2)) > 6.1", "sqrt(2)) > 6.3"),
			});
			const r = await verify();
			expect(r.find((c) => c.id === "checks-true")?.passed).toBe(false);
		});
	});

	test("checks report how sure they are: exact by rationals, symbols or intervals; numeric otherwise", async () => {
		const { runMath } = await import("../../../tools/math.ts");
		const item = (lhs: string, op: "<" | ">" | "=", rhs: string) => ({
			line: "",
			lhs,
			op,
			rhs,
		});
		const r = await runMath({
			items: [
				item("6*(sqrt(6)-sqrt(2))", ">", "6.1"),
				item("2.449^2", "<", "6"),
				item("zeta(4)", "=", "pi^4/90"),
				item("polylog(4,1/2)", ">", "0.5"),
			],
		});
		expect(r.map((x) => [x.ok, x.assurance])).toEqual([
			[true, "exact"],
			[true, "exact"],
			[true, "exact"],
			[true, "numeric"],
		]);
	});

	test("zbar(5, 1) evaluates to its tabulated value; other arguments are refused", async () => {
		const { runMath, checkNames } = await import("../../../tools/math.ts");
		expect(checkNames).toContain("zbar");
		const item = (lhs: string, op: "<" | ">" | "=", rhs: string) => ({
			line: "",
			lhs,
			op,
			rhs,
		});
		const r = await runMath({
			items: [
				item("2*zbar(5, 1)", "=", "zbar(5,1) + zbar(5,1)"),
				item(
					"zbar(5, 1)",
					"=",
					"-0.029901635581149425942867921749100313765790341118585104567249612458718",
				),
				item("zbar(5, 1)", "=", "-0.0299016355811494259428679"),
				item("zbar(3, 1)", "<", "0"),
			],
		});
		expect(r.map((x) => [x.ok, x.assurance])).toEqual([
			[true, "exact"],
			[true, "numeric"],
			[false, "numeric"],
			[false, undefined],
		]);
	});

	test("closed-form answers are compared exactly", async () => {
		await withTask("e4-euler-sum-h2", 0, async (call, verify) => {
			await call("submit_answer", { expression: "2*zeta(3)" });
			expect((await verify())[0]?.passed).toBe(false);
			await call("submit_answer", { expression: "17*pi^4/360" });
			expect((await verify())[0]?.passed).toBe(true);
			expect(
				(await call("submit_answer", { expression: "__import__('os')" }))
					.status,
			).toBe("error");
		});
	});

	test("lemma-level notes appear only at tier 3", async () => {
		const ids = async (tier: 2 | 3) =>
			withTask("e4-zeta3-irrational", tier, async (call) =>
				JSON.stringify(
					(await call("search_reference", { query: "Beukers 積分 補題" }))
						.output,
				),
			);
		expect(await ids(2)).not.toContain("beukers-lemmas");
		expect(await ids(3)).toContain("beukers-lemmas");
	});

	test("calc and references work offline", async () => {
		await withTask("e3-serret-integral", 2, async (call) => {
			const v = await call("calc", { expression: "pi*log(2)/8", digits: 12 });
			expect(String((v.output as { value: string }).value)).toStartWith(
				"0.27219826",
			);
			const s = await call("search_reference", { query: "置換 対称性 tan" });
			expect(JSON.stringify(s.output)).toContain("substitution");
		});
	});
});
