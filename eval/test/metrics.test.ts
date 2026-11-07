import { describe, expect, test } from "bun:test";
import type { PursuitView } from "../../src/index.ts";
import { ending } from "../horizon.ts";
import { totalUsage } from "../../standalone/usage.ts";
import { openSettings } from "../../standalone/settings.ts";
import { runDirect } from "../direct.ts";
import {
	detection,
	isCorrect,
	measure,
	measureDirect,
	type RunRecord,
	summarize,
	summarizePlanned,
} from "../metrics.ts";

test("planned success rates retain missing and invalid observations and separate configurations", () => {
	const planned = [
		{ task: "a", condition: "E1R", configId: "A", repeat: 1 },
		{ task: "b", condition: "E1R", configId: "A", repeat: 1 },
		{ task: "c", condition: "D0", configId: "B", repeat: 1 },
	];
	const completed = rec({ task: "a", configId: "A", repeat: 1 });
	const invalid = rec({
		task: "c",
		condition: "D0",
		configId: "B",
		repeat: 1,
		error: "failed",
	});
	const table = summarizePlanned(planned, [
		completed,
		completed,
		invalid,
		rec({ task: "legacy" }),
	]);
	expect(table).toContain("予定 3 件、対応する記録 2 件、未記録 1 件");
	expect(table).toContain("予定外・旧形式の記録 1 件");
	expect(table).toContain("| E1R | A | 2 | 1 | 1 | 0 | 1/2 (50%) |");
	expect(table).toContain("| D0 | B | 1 | 1 | 0 | 1 | 0/1 (0%) |");
});

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
		expected: "incomplete",
		outcome: "stopped",
		verified: false,
		reason: "やめる",
		correct: true,
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

const view = (report: PursuitView["report"]) =>
	({
		id: "p",
		status: "stopped",
		report,
		attempts: [],
		inference: [],
		decisions: [],
		verifications: [],
		hypotheses: [],
		strategies: [],
		consultations: [],
		findings: [],
		judgements: [],
	}) as unknown as PursuitView;

for (const scenario of [
	{
		name: "cache writes",
		price: { input: 2, output: 10 },
		input: 1000,
		written: 50,
		expected: 0.004145,
	},
	{
		name: "custom cache read tariff",
		price: { input: 2, output: 10, cacheRead: 1 },
		input: 1000,
		written: 0,
		expected: 0.0041,
	},
	{
		name: "long context tariff",
		price: {
			input: 2,
			output: 10,
			inputLong: 4,
			outputLong: 20,
			longThreshold: 1000,
		},
		input: 2000,
		written: 50,
		expected: 0.01229,
	},
])
	test(`pursuit and direct metrics use host billing for ${scenario.name}, including unknown costs`, async () => {
		const settings = openSettings(":memory:");
		try {
			settings.set("spend.pricing", { m: scenario.price });
			const meter = settings.meter();
			meter.record("m", {
				input_tokens: scenario.input,
				output_tokens: 200,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: scenario.written,
			});
			const tokens = {
				model: "m",
				inputTokens: scenario.input + scenario.written,
				outputTokens: 200,
				cacheReadTokens: 100,
				latencyMs: 1,
			};
			const direct = await runDirect({
				goal: "fixture",
				acceptance: [{ id: "a", text: "fixture" }],
				grant: [],
				workspace: null,
				tools: {
					list: () => [],
					invoke: async () => {
						throw new Error("unused");
					},
				},
				acceptancePort: {
					verify: async () => [{ id: "a", passed: false, evidence: "fixture" }],
				},
				llm: {
					complete: async (r) => ({
						...tokens,
						value: r.schema.parse({
							kind: "give_up",
							tool: null,
							inputJson: null,
							text: null,
							message: "fixture",
						}),
					}),
				},
				budget: { toolCalls: 1, requests: 1, wallMs: 1000 },
				signal: new AbortController().signal,
			});
			const ledger = {
				...view(null),
				inference: [{ purpose: "plan", ...tokens }],
			};
			const usage = totalUsage(meter.events());
			expect(usage.usd).toBeCloseTo(scenario.expected, 10);
			for (const measured of [
				measure(ledger, usage),
				measureDirect(direct, "d", usage),
			]) {
				expect(measured).toMatchObject({
					usd: usage.usd,
					llmCalls: usage.calls,
					inputTokens: scenario.input + scenario.written + 100,
					outputTokens: 200,
				});
				expect(measured.usage).toBe(usage);
			}
			meter.recordUnknown!({
				callId: "unknown",
				requestedModel: "m",
				status: "error",
				latencyMs: 0,
			});
			const unknown = totalUsage(meter.events());
			for (const measured of [
				measure(ledger, unknown),
				measureDirect(direct, "d", unknown),
			]) {
				expect(measured.usd).toBeNull();
				expect(measured.usage?.costStatus).toBe("unknown");
				expect(measured.llmCalls).toBe(2);
			}
		} finally {
			settings.close();
		}
	});

describe("unfinished final verification (spec/fixes-2026-10-22.md §h)", () => {
	const report = {
		outcome: "stopped" as const,
		verified: false,
		reason: "やめる",
		criteria: [],
		summary: "",
	} as unknown as NonNullable<PursuitView["report"]>;

	test("measure carries Report.verificationIssue only when present", () => {
		expect(
			measure(view({ ...report, verificationIssue: "aborted" }), totalUsage([]))
				.verificationIssue,
		).toBe("aborted");
		expect("verificationIssue" in measure(view(report), totalUsage([]))).toBe(
			false,
		);
	});

	test("a record whose final verification did not finish is never correct", () => {
		const r = {
			outcome: "stopped",
			verified: false,
			reason: "やめる",
			error: null,
		};
		expect(isCorrect("incomplete", r)).toBe(true);
		for (const issue of ["pending", "aborted", "failed"] as const)
			expect(isCorrect("incomplete", { ...r, verificationIssue: issue })).toBe(
				false,
			);
	});

	test("ending keeps it apart from judged endings", () => {
		expect(
			ending(rec({ verificationIssue: "pending" }), { decisions: [] }),
		).toBe("verification_pending");
	});

	test("summary leaves it out of the correct share and shows pending/aborted/failed separately", () => {
		const table = summarize([
			rec({ task: "a" }),
			rec({ task: "b", correct: false, verificationIssue: "pending" }),
			rec({ task: "c", correct: false, verificationIssue: "failed" }),
			rec({ task: "d", correct: false, verificationIssue: "failed" }),
		]);
		expect(table).toContain("最終照合の未了（保留/中止/失敗）");
		expect(table).toContain(
			"| g@legacy | E1R | E | 4 | 100% (n=1, 未了3を除く) |",
		);
		expect(table).toMatch(/\| 1\/0\/2 \|$/m);
		expect(summarize([rec({})])).toMatch(
			/\| g@legacy \| E1R \| E \| 1 \| 100% \|.*\| - \|$/m,
		);
	});

	test("detection does not count it", () => {
		const table = detection([
			rec({ expected: "completed", outcome: "stopped" }),
			rec({
				task: "b",
				expected: "completed",
				verificationIssue: "aborted",
			}),
		]);
		expect(table).toContain("| g@legacy | E1R | E | 1 |");
	});
});

test("comparison keeps distinct configurations separate even at equal mode and budget", async () => {
	const { compare } = await import("../metrics.ts");
	const text = compare([
		rec({ configId: "A", outcome: "stopped", correct: false }),
		rec({ configId: "B", outcome: "completed", verified: true, correct: true }),
	]);
	expect(text).toContain("g@A");
	expect(text).toContain("g@B");
	expect(text).toContain("0%");
	expect(text).toContain("100%");
	expect(text).not.toContain("50%");
});
