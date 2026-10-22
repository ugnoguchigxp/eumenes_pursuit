import { describe, expect, test } from "bun:test";
import { conditionsSchema } from "../../src/index.ts";
import { verdictText } from "../../src/domains/generation/prompts.ts";
import type { AttemptRow } from "../../src/domains/ledger/types.ts";
import { refutationHeld } from "../../src/domains/rules/refutation.ts";
import { startInput } from "../support.ts";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

const attempt = (
	refutedIf: string | undefined,
	status: "ok" | "error",
	output: unknown,
	expectedStatus: "ok" | "error" = "ok",
	outcome: "success" | "failure" = status === expectedStatus
		? "success"
		: "failure",
) =>
	({
		seq: 1,
		tool: "run",
		input: {},
		outcome,
		prediction: {
			expectedStatus,
			expectedObservation: "x",
			...(refutedIf ? { refutedIf } : {}),
		},
		observation: { status, output, refs: [] },
	}) as unknown as AttemptRow;

describe("refutedIf grammar (spec/fixes-2026-10-22.md §b)", () => {
	test("clauses are judged against the observation", () => {
		const ok = (output: unknown) => ({
			status: "ok" as const,
			output: output as never,
		});
		expect(
			refutationHeld('contains:"FAILED"', ok({ stdout: "2 FAILED" })),
		).toBe(true);
		expect(
			refutationHeld('contains:"FAILED"', ok({ stdout: "all passed" })),
		).toBe(false);
		expect(refutationHeld('not_contains:"passed"', ok("all passed"))).toBe(
			false,
		);
		expect(
			refutationHeld(
				'status:error || contains:"Trace"',
				ok(["x", "Traceback"]),
			),
		).toBe(true);
		expect(refutationHeld("status:ok", ok(""))).toBe(true);
		expect(refutationHeld('contains:"say \\"hi\\""', ok('they say "hi"'))).toBe(
			true,
		);
	});

	test("a needle may quote the JSON form the generator was shown", () => {
		const probe = {
			status: "ok" as const,
			output: {
				results: [
					{ input: "b8dc", output: "41" },
					{ input: "d88b", output: "77" },
				],
			},
		};
		// hz11u-pursuit-r1 hz11-black-box #12 was labelled refuted when only string values were searched.
		expect(
			refutationHeld(
				'not_contains:"\\"output\\":\\"41\\"" || not_contains:"\\"output\\":\\"77\\""',
				probe,
			),
		).toBe(false);
		expect(refutationHeld('not_contains:"\\"output\\":\\"86\\""', probe)).toBe(
			true,
		);
		expect(refutationHeld('contains:"41"', probe)).toBe(true);
	});

	test("|| inside a needle, JSON escapes and a dangling separator", () => {
		const ok = (output: string) => ({ status: "ok" as const, output });
		expect(refutationHeld('contains:"a || b"', ok("x a || b"))).toBe(true);
		expect(refutationHeld('contains:"line1\\nline2"', ok("line1\nline2"))).toBe(
			true,
		);
		expect(refutationHeld('contains:"a" ||', ok("a"))).toBeNull();
		expect(refutationHeld("テストが失敗したら", ok(""))).toBeNull();
		expect(refutationHeld('contains:"a" || 失敗したら', ok("a"))).toBeNull();
		expect(refutationHeld('contains:"a"', null)).toBeNull();
	});
});

describe("attempt verdict label (spec/fixes-2026-10-22.md §b)", () => {
	test("refutation is the default; older conditions parse to it", () => {
		const { verdictLabel, ...old } = startInput().conditions;
		expect(conditionsSchema.parse(old).verdictLabel).toBe("refutation");
		expect(verdictLabel).toBe("refutation");
	});

	test("never 予測どおり from the tool status alone", () => {
		const labels = [
			verdictText(attempt(undefined, "ok", "x")),
			verdictText(attempt("テストが失敗したら", "ok", "x")),
		];
		for (const l of labels) {
			expect(l.startsWith("未判定")).toBe(true);
			expect(l).not.toBe("予測どおり");
		}
		expect(
			verdictText(attempt('contains:"FAILED"', "ok", "2 FAILED")),
		).toContain("反証の条件に当たった");
		expect(verdictText(attempt('contains:"FAILED"', "ok", "ok"))).toContain(
			"当たらなかった",
		);
		expect(verdictText(attempt(undefined, "error", "x"))).toBe(
			"予測と違う（状態は予測の ok ではなく error）",
		);
		expect(
			verdictText(attempt(undefined, "ok", "x", "ok", "failure")),
		).toContain("観測の照合");
	});

	test("status keeps the v1.6 wording for reproducing earlier runs", () => {
		expect(verdictText(attempt("x", "ok", "out"), "status")).toBe("予測どおり");
		expect(verdictText(attempt("x", "error", "out"), "status")).toBe(
			"予測と違う/失敗",
		);
	});

	test("the proposal request labels executed attempts by refutedIf and explains the grammar", async () => {
		const { prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis],
				propose: [
					call("read", {}, { refutedIf: 'contains:"FAILED"' }),
					proposal("give_up", { refutedIf: null }),
				],
			},
			conditions: { prediction: "falsifiable" },
			runtime: runtime({
				invoke: () => ({
					status: "ok",
					output: { stdout: "2 FAILED" },
					refs: [],
				}),
			}),
		});
		const last = prompts.filter((p) => p.purpose === "propose").at(-1)!.prompt;
		expect(last).toContain("判定: 反証の条件に当たった");
		expect(last).not.toContain("判定: 予測どおり");
		expect(last).toContain('not_contains:"文字列"');
	});
});

describe("hz11h follow-ups (spec/fixes-2026-10-22-d.md §3)", () => {
	test("§3.1 refutedIf is judged on the full text, not the clipped display", () => {
		const clipped = {
			status: "ok" as const,
			output: { stdout: "=== a.py\n...[省略]...\n=== z.py" },
			unclipped: ["=== a.py\n=== engine.py\n=== z.py"],
		};
		// hz11h-pursuit-r1 billing #3: the needle sat in the clipped middle and read as refuted.
		expect(refutationHeld('not_contains:"=== engine.py"', clipped)).toBe(false);
		expect(
			refutationHeld('not_contains:"=== engine.py"', {
				status: clipped.status,
				output: clipped.output,
			}),
		).toBe(true);
		const row = attempt('not_contains:"=== engine.py"', "ok", clipped.output);
		const full = {
			...row,
			observation: { ...row.observation!, unclipped: clipped.unclipped },
		} as AttemptRow;
		expect(verdictText(full)).toBe(
			"反証の条件に当たらなかった（状態も予測どおり。表示は一部省略だが、判定は省略部分を含む全文で行った）",
		);
	});

	test("§3.4 a stated refutedIf decides the label; a status mismatch is said beside it", () => {
		expect(
			verdictText(attempt("status:error", "ok", "x", "error", "failure")),
		).toBe("反証の条件に当たらなかった（状態は予測の error ではなく ok）");
		expect(verdictText(attempt("status:error", "error", "x"))).toBe(
			"反証の条件に当たった（仮説は誤りの可能性が高い）",
		);
		expect(verdictText(attempt("テストが失敗したら", "error", "x"))).toBe(
			"予測と違う（状態は予測の ok ではなく error）",
		);
	});
});
