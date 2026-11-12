import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxed } from "../tools/sandbox.ts";
import type { Workload } from "./data.ts";

export const candidateFile = "windowsum.py";
export const candidateTimeoutMs = 3000;
export type Sample = {
	readonly ms: number;
	readonly status: "ok" | "incorrect" | "timeout" | "failed";
	readonly mismatch?: {
		readonly line: number;
		readonly expected: string | null;
		readonly actual: string | null;
	};
};
export type Runner = (
	source: string,
	input: Workload,
	timeoutMs: number,
	signal: AbortSignal,
	diagnoseMismatch?: boolean,
) => Promise<Sample>;

export async function executeCandidate(
	source: string,
	input: string,
	timeoutMs: number,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const dir = await mkdtemp(join(tmpdir(), "optimizer-candidate-"));
	try {
		await writeFile(join(dir, candidateFile), source);
		const result = await runSandboxed({
			workDir: dir,
			command: `exec /usr/bin/python3 ${candidateFile}`,
			stdin: input,
			timeoutMs,
			maxOutput: 8 * 1024 * 1024,
			rawStdout: true,
			signal,
		});
		signal.throwIfAborted();
		return result;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export function firstOutputMismatch(
	expected: string,
	actual: string,
): Sample["mismatch"] {
	const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const want = lines(expected);
	const got = lines(actual);
	for (let i = 0; i < Math.max(want.length, got.length); i++) {
		if (want[i] !== got[i])
			return {
				line: i + 1,
				expected: want[i]?.slice(0, 160) ?? null,
				actual: got[i]?.slice(0, 160) ?? null,
			};
	}
}

export const runCandidate: Runner = async (
	source,
	input,
	timeoutMs,
	signal,
	diagnoseMismatch,
) => {
	const result = await executeCandidate(source, input.input, timeoutMs, signal);
	const incorrect =
		!result.timedOut &&
		result.exitCode === 0 &&
		result.stdout !== input.expected;
	const mismatch =
		incorrect && diagnoseMismatch
			? firstOutputMismatch(input.expected, result.stdout)
			: undefined;
	return {
		ms: result.ms,
		status: result.timedOut
			? "timeout"
			: result.exitCode !== 0
				? "failed"
				: result.stdout === input.expected
					? "ok"
					: "incorrect",
		...(mismatch ? { mismatch } : {}),
	};
};

export async function checkCorrectness(
	run: Runner,
	source: string,
	inputs: readonly Workload[],
	signal: AbortSignal,
	diagnoseMismatch = false,
) {
	const results = [];
	for (const input of inputs) {
		signal.throwIfAborted();
		const { status, mismatch } = await run(
			source,
			input,
			candidateTimeoutMs,
			signal,
			diagnoseMismatch,
		);
		results.push({
			id: input.id,
			status,
			...(diagnoseMismatch && mismatch ? { mismatch } : {}),
		});
	}
	signal.throwIfAborted();
	return results;
}

export interface Pair {
	readonly control: Sample;
	readonly candidate: Sample;
}
export interface Series {
	readonly id: string;
	readonly warmup: Pair;
	readonly pairs: readonly Pair[];
}

export const repeats = 7;
export async function measure(
	run: Runner,
	control: string,
	candidate: string,
	inputs: readonly Workload[],
	signal: AbortSignal,
): Promise<Series[]> {
	const result: Series[] = [];
	for (const input of inputs) {
		const warmup = {
			control: await run(control, input, candidateTimeoutMs, signal),
			candidate: await run(candidate, input, candidateTimeoutMs, signal),
		};
		const pairs: Pair[] = [];
		if (warmup.control.status === "ok" && warmup.candidate.status === "ok") {
			for (let i = 0; i < repeats; i++) {
				signal.throwIfAborted();
				const firstIsControl = i % 2 === 0;
				const first = await run(
					firstIsControl ? control : candidate,
					input,
					candidateTimeoutMs,
					signal,
				);
				const second = await run(
					firstIsControl ? candidate : control,
					input,
					candidateTimeoutMs,
					signal,
				);
				pairs.push(
					firstIsControl
						? { control: first, candidate: second }
						: { control: second, candidate: first },
				);
				if (first.status !== "ok" || second.status !== "ok") break;
			}
		}
		result.push({ id: input.id, warmup, pairs });
	}
	signal.throwIfAborted();
	return result;
}

export function completeSeries(series: Series): boolean {
	return (
		series.pairs.length === repeats &&
		[series.warmup, ...series.pairs].every(({ control, candidate }) =>
			[control, candidate].every(
				(s) => s.status === "ok" && Number.isFinite(s.ms) && s.ms >= 0,
			),
		)
	);
}

export function percentile(values: readonly number[], p: number): number {
	return [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
}

export function improvements(series: Series) {
	return series.pairs.map(
		({ control, candidate }) => control.ms - candidate.ms,
	);
}

export function measurementEvidence(
	results: readonly Series[],
	noise: Readonly<Record<string, number>>,
) {
	return results.map((series, i) => {
		const threshold = noise[series.id];
		const primary = i === 0;
		if (!completeSeries(series)) {
			const firstFailure = [series.warmup, ...series.pairs].find(
				({ control, candidate }) =>
					control.status !== "ok" || candidate.status !== "ok",
			);
			return {
				id: series.id,
				primary,
				reason: "incomplete_series" as const,
				pairs: series.pairs.length,
				...(firstFailure
					? {
							controlStatus: firstFailure.control.status,
							candidateStatus: firstFailure.candidate.status,
						}
					: {}),
			};
		}
		if (threshold === undefined || !Number.isFinite(threshold) || threshold < 0)
			return { id: series.id, primary, reason: "invalid_threshold" as const };
		const differences = improvements(series);
		const medianGainMs = percentile(differences, 0.5);
		const fasterPairs = differences.filter((n) => n > 0).length;
		const reason =
			medianGainMs < -threshold
				? primary
					? "primary_regression"
					: "secondary_regression"
				: primary
					? medianGainMs <= threshold
						? "gain_within_noise"
						: fasterPairs < 6
							? "too_few_faster_pairs"
							: "passed"
					: "passed";
		return {
			id: series.id,
			primary,
			reason,
			medianGainMs,
			thresholdMs: threshold,
			fasterPairs,
		};
	});
}

export function promotes(
	results: readonly Series[],
	noise: Readonly<Record<string, number>>,
): boolean {
	return (
		results.length > 0 &&
		measurementEvidence(results, noise).every(
			({ reason }) => reason === "passed",
		)
	);
}

export async function absoluteTarget(
	run: Runner,
	source: string,
	inputs: readonly Workload[],
	signal: AbortSignal,
) {
	const results = [];
	for (const input of inputs) {
		const warmup = await run(source, input, candidateTimeoutMs, signal);
		const samples: Sample[] = [];
		if (warmup.status === "ok" && warmup.ms <= candidateTimeoutMs) {
			for (let i = 0; i < repeats; i++) {
				signal.throwIfAborted();
				const sample = await run(source, input, candidateTimeoutMs, signal);
				samples.push(sample);
				if (sample.status !== "ok" || sample.ms > candidateTimeoutMs) break;
			}
		}
		results.push({ id: input.id, warmup, samples });
	}
	signal.throwIfAborted();
	return results;
}
