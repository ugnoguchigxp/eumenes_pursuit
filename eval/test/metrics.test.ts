import { describe, expect, test } from "bun:test";
import type { PursuitView } from "../../src/index.ts";
import { ending } from "../horizon.ts";
import {
	detection,
	isCorrect,
	measure,
	type RunRecord,
	summarize,
} from "../metrics.ts";

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
			measure(
				view({ ...report, verificationIssue: "aborted" }),
				() => undefined,
			).verificationIssue,
		).toBe("aborted");
		expect("verificationIssue" in measure(view(report), () => undefined)).toBe(
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
