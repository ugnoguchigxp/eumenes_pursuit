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
		expect(verdictText(attempt('contains:"x"', "error", "x"))).toContain(
			"状態が予測と違う",
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
