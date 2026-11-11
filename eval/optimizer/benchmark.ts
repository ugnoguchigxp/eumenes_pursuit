import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxed } from "../tools/sandbox.ts";
import type { Workload } from "./data.ts";

export const candidateFile = "windowsum.py";
export type Sample = {
	readonly ms: number;
	readonly status: "ok" | "incorrect" | "timeout" | "failed";
};
export type Runner = (
	source: string,
	input: Workload,
	timeoutMs: number,
	signal: AbortSignal,
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

export const runCandidate: Runner = async (
	source,
	input,
	timeoutMs,
	signal,
) => {
	const result = await executeCandidate(source, input.input, timeoutMs, signal);
	return {
		ms: result.ms,
		status: result.timedOut
			? "timeout"
			: result.exitCode !== 0
				? "failed"
				: result.stdout === input.expected
					? "ok"
					: "incorrect",
	};
};

export async function checkCorrectness(
	run: Runner,
	source: string,
	inputs: readonly Workload[],
	signal: AbortSignal,
) {
	const results = [];
	for (const input of inputs) {
		signal.throwIfAborted();
		const { status } = await run(source, input, 3000, signal);
		results.push({ id: input.id, status });
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
			control: await run(control, input, 3000, signal),
			candidate: await run(candidate, input, 3000, signal),
		};
		const pairs: Pair[] = [];
		if (warmup.control.status === "ok" && warmup.candidate.status === "ok") {
			for (let i = 0; i < repeats; i++) {
				signal.throwIfAborted();
				const firstIsControl = i % 2 === 0;
				const first = await run(
					firstIsControl ? control : candidate,
					input,
					3000,
					signal,
				);
				const second = await run(
					firstIsControl ? candidate : control,
					input,
					3000,
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

export function promotes(
	results: readonly Series[],
	noise: Readonly<Record<string, number>>,
): boolean {
	if (!results.length || !results.every(completeSeries)) return false;
	return results.every((series, i) => {
		const threshold = noise[series.id];
		if (threshold === undefined || !Number.isFinite(threshold) || threshold < 0)
			return false;
		const differences = improvements(series);
		const median = percentile(differences, 0.5);
		return i === 0
			? median > threshold && differences.filter((n) => n > 0).length >= 6
			: median >= -threshold;
	});
}

export async function absoluteTarget(
	run: Runner,
	source: string,
	inputs: readonly Workload[],
	signal: AbortSignal,
) {
	const results = [];
	for (const input of inputs) {
		const warmup = await run(source, input, 3000, signal);
		const samples: Sample[] = [];
		if (warmup.status === "ok" && warmup.ms <= 3000) {
			for (let i = 0; i < repeats; i++) {
				signal.throwIfAborted();
				const sample = await run(source, input, 3000, signal);
				samples.push(sample);
				if (sample.status !== "ok" || sample.ms > 3000) break;
			}
		}
		results.push({ id: input.id, warmup, samples });
	}
	signal.throwIfAborted();
	return results;
}
