import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectMode } from "../adaptive.ts";
import { efficiency, verificationEvidence } from "../efficiency.ts";
import { readCheckpoint, writeCheckpoint } from "../job-checkpoint.ts";
import {
	defineStudy,
	validateStudyReport,
	type Experiment,
} from "../tasks/study.ts";
import { simulate } from "../tasks/study-simulator.ts";
import { defineEnvTask } from "../tasks/e/env.ts";
import type { RunRecord } from "../metrics.ts";

test("a task with a host-only in-memory probe quota cannot reset that quota by reopening", async () => {
	const task = defineEnvTask({
		id: "probe-resume-fixture",
		title: "fixture",
		statement: "fixture",
		level: 4,
		traps: [],
		protectedPrefixes: [],
		probe: { maxCalls: 2, maxInputs: 1 },
	});
	expect(task.resumable).toBe(false);
	await expect(
		task.create("/unreachable-fixture", {
			resume: true,
			grader: null,
			toolTier: 0,
		}),
	).rejects.toThrow("probe_task_resume_unsupported");
});

test("mode selection passes task, tools, model and budget to an LLM and validates the choice", async () => {
	for (const condition of ["D0", "E1R"] as const) {
		let seen = "";
		const selection = await selectMode({
			llm: {
				async complete(r) {
					seen = r.system + r.prompt;
					return {
						value: r.schema.parse({
							condition,
							reason: "budget-dependent fixture decision",
						}),
						model: "fixture",
						inputTokens: 1,
						outputTokens: 1,
						cacheReadTokens: 0,
						latencyMs: 0,
					};
				},
			},
			goal: "arbitrary renamed task",
			tools: [],
			model: "renamed-model",
			budget: { toolCalls: 77, requests: 350, wallMs: 90000 },
			signal: new AbortController().signal,
		});
		expect(selection.condition).toBe(condition);
		expect(seen).toContain("renamed-model");
		expect(seen).toContain("90000");
		expect(seen).toContain("arbitrary renamed task");
	}
});

test("efficiency includes failed-run expenditure and never converts missing costs to zero", () => {
	const records = [
		{ correct: true, error: null, usd: 2, durationMs: 100 },
		{ correct: false, error: null, usd: 3, durationMs: 200 },
	] as RunRecord[];
	expect(efficiency(records)).toMatchObject({
		correct: 1,
		usdPerCorrect: 5,
		msPerCorrect: 300,
	});
	expect(efficiency(records, 3).usd).toBeNull();
	expect(efficiency([{ ...records[0]!, usd: null }]).usdPerCorrect).toBeNull();
	expect(efficiency([records[1]!]).usdPerCorrect).toBeNull();
	expect(
		verificationEvidence({ hostPassed: true, assurance: "model" })
			.falseAcceptance,
	).toBeNull();
	expect(
		verificationEvidence({
			hostPassed: true,
			assurance: "model",
			independent: { passed: true, basis: "model" },
		}).falseAcceptance,
	).toBeNull();
	expect(
		verificationEvidence({
			hostPassed: true,
			assurance: "model",
			independent: { passed: false, basis: "exact" },
		}).falseAcceptance,
	).toBe(true);
});

test("checkpoint preserves identity and accounting scope and rejects changed configuration", () => {
	const directory = mkdtempSync(join(tmpdir(), "study-checkpoint-")),
		path = join(directory, "checkpoint.json");
	try {
		const checkpoint = {
			format: 1 as const,
			key: "job",
			configId: "config",
			pursuitId: "p1",
			directory,
			started: 10,
			scope: {
				runId: "run",
				configId: "config",
				jobId: "job",
				pursuitId: "p1",
				budgetId: "budget",
			},
			selection: { condition: "E1R" as const, reason: "fixture" },
			selectedCondition: "E1R",
			paused: true,
			pauseStartedAt: 10,
			pausedMs: 0,
			restarts: 0,
			status: "active" as const,
		};
		writeCheckpoint(path, checkpoint);
		expect(readCheckpoint(path, "job", "config")).toEqual(checkpoint);
		expect(() => readCheckpoint(path, "job", "changed")).toThrow(
			"checkpoint_configuration_mismatch",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("study verifier accepts inconclusive evidence and rejects fabricated, altered, duplicate or missing observations", () => {
	const event: Experiment = {
		id: "e1",
		weights: { age: 1, frequency: 0, cost: 0, fairness: 0 },
		seed: 1,
		metrics: { served: 7, missed: 3, cost: 9, groupSpread: 2 },
	};
	const report = {
		conclusion: "inconclusive",
		summary: "a tradeoff remains",
		uncertainty: "no claim of optimum",
		evidence: [event],
		recommendations: [],
	};
	expect(validateStudyReport(report, [event])).toBe(true);
	expect(validateStudyReport(null, [event])).toBe(false);
	expect(
		validateStudyReport({ ...report, evidence: [{ ...event, id: "fake" }] }, [
			event,
		]),
	).toBe(false);
	expect(
		validateStudyReport(
			{
				...report,
				evidence: [{ ...event, metrics: { ...event.metrics, cost: 0 } }],
			},
			[event],
		),
	).toBe(false);
	expect(
		validateStudyReport({ ...report, evidence: [event, event] }, [event]),
	).toBe(false);
	expect(
		validateStudyReport(
			{
				...report,
				recommendations: [{ experimentId: "fake", tradeoff: "unsupported" }],
			},
			[event],
		),
	).toBe(false);
});

for (const kind of ["cache", "scheduler"] as const)
	test(`${kind}: observed results survive reopening; host verifies actual provenance`, async () => {
		const directory = mkdtempSync(join(tmpdir(), `study-${kind}-`)),
			task = defineStudy(kind),
			signal = new AbortController().signal;
		try {
			const context = { grader: null, toolTier: 0 as const };
			let instance = await task.create(directory, context);
			expect((await instance.acceptance.verify(signal))[0]!.passed).toBe(false);
			const outcome = await instance.tools.invoke(
				{
					tool: "run_experiment",
					input: {
						weights: { age: 1, frequency: 0, cost: 0, fairness: 0 },
						seed: 4,
					},
				},
				signal,
			);
			const event = outcome.output as unknown as Experiment;
			expect(event.metrics).toEqual(simulate(kind, event.weights, 4));
			if (kind === "cache")
				expect(event.metrics.served + event.metrics.missed).toBe(3000);
			instance = await task.create(directory, { ...context, resume: true });
			const content = JSON.stringify({
				conclusion: "inconclusive",
				summary: "evidence only",
				uncertainty: "not optimality",
				evidence: [event],
				recommendations: [],
			});
			await instance.tools.invoke(
				{ tool: "submit_report", input: { content } },
				signal,
			);
			expect((await instance.acceptance.verify(signal))[0]!.passed).toBe(true);
			await instance.tools.invoke(
				{
					tool: "submit_report",
					input: {
						content: content.replace(
							'"served":' + event.metrics.served,
							'"served":999999',
						),
					},
				},
				signal,
			);
			expect((await instance.acceptance.verify(signal))[0]!.passed).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
