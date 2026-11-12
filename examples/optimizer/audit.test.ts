import { expect, test } from "bun:test";
import { absoluteTarget } from "../../eval/optimizer/benchmark.ts";
import { auditBudgetMs, auditSubmission } from "./audit.ts";
import { unstableCalibration } from "./fixtures.ts";

const fixture = {
	correctness: [{ id: "small", input: "", expected: "" }],
	speed: ["mixed", "concentrated", "distributed"].map((id) => ({
		id,
		input: "",
		expected: "",
	})),
};

test("keeps noisy calibration distinct from a failed submission", () => {
	const sample = { ms: 27, status: "ok" as const };
	const pair = { control: sample, candidate: sample };
	const series = [
		{ id: "mixed", warmup: pair, pairs: Array.from({ length: 7 }, () => pair) },
	];
	expect(unstableCalibration(series, { mixed: 15.45 })).toMatchObject([
		{ id: "mixed", baselineMs: 27, thresholdMs: 15.45 },
	]);
	expect(unstableCalibration(series, { mixed: 3 })).toEqual([]);
});

test("a qualifying 24-run submission fits the independent audit budget", async () => {
	const result = await auditSubmission(
		async () => fixture,
		async (_, speed, signal) => {
			let wall = 0;
			const samples = await absoluteTarget(
				async () => {
					wall += 2600;
					return { ms: 2600, status: "ok" };
				},
				"",
				speed,
				signal,
			);
			expect(wall).toBe(62400);
			expect(auditBudgetMs(fixture)).toBeGreaterThan(wall + 3000);
			return { passed: samples.every((sample) => sample.samples.length === 7) };
		},
		new AbortController().signal,
	);
	expect(result.status).toBe("passed");
});

test("audit interruption and fixture errors are recorded as outcomes", async () => {
	const stop = new AbortController();
	const interrupted = await auditSubmission(
		async () => fixture,
		async (_, __, signal) => {
			stop.abort(new Error("test interruption"));
			signal.throwIfAborted();
			return { passed: true };
		},
		stop.signal,
	);
	expect(interrupted).toEqual({
		status: "interrupted",
		reason: "test interruption",
	});
	const failed = await auditSubmission(
		async () => {
			throw new Error("fixture unavailable");
		},
		async () => ({ passed: true }),
		new AbortController().signal,
	);
	expect(failed).toEqual({ status: "error", reason: "fixture unavailable" });
});
