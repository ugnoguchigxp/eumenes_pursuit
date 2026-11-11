import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LlmPort } from "../../src/index.ts";
import { createRoleLlm } from "../../standalone/llm.ts";
import { openSettings } from "../../standalone/settings.ts";
import { totalUsage } from "../../standalone/usage.ts";
import { evaluatorModel, reviewReport } from "./evaluator.ts";
import {
	cases,
	fixture,
	scripted,
	scriptedEvaluator,
	type Case,
} from "./fixtures.ts";
import { openExample, type HostOptions } from "./host.ts";
import provenance from "./provenance.json";

const args = process.argv.slice(2);
const useEvaluator = args.includes("--evaluator");
const [
	mode = "fixture",
	variant = "productive",
	selection = "museum",
	output = "artifacts/eumenes-example",
	baselinePath,
] = args.filter((arg) => arg !== "--evaluator");
if (
	!["fixture", "api"].includes(mode) ||
	!["legacy", "productive"].includes(variant)
)
	throw new Error(
		"Usage: bun examples/eumenes/run.ts fixture|api legacy|productive case[,case] output-dir [baseline-source-dir] [--evaluator]",
	);
const selected = selection.split(",") as Case[];
if (selected.some((name) => !cases.includes(name)))
	throw new Error("unknown_fixture");
if (baselinePath && variant !== "legacy")
	throw new Error("baseline_requires_legacy");
const baseline = baselinePath
	? {
			create: (await import(join(resolve(baselinePath), "index.ts")))
				.createPursuitEngine,
			migrations: (await import(join(resolve(baselinePath), "sqlite.ts")))
				.migrations,
		}
	: undefined;
const root = resolve(output);
mkdirSync(root, { recursive: true });
const settings = mode === "api" ? openSettings() : null;
const role = settings?.require("llm.generator");
const evaluatorRole = useEvaluator
	? settings?.require("llm.reviewer")
	: undefined;
const campaign = "eumenes-example-20261109";
if (settings) settings.setBudget(`campaign:${campaign}`, 5);
const summary = [];
const signal = new AbortController();
process.on("SIGINT", () => signal.abort());
try {
	for (const name of selected) {
		signal.signal.throwIfAborted();
		const directory = join(root, name);
		mkdirSync(directory, { recursive: true });
		const eventPath = join(directory, "events.jsonl");
		if (existsSync(eventPath)) throw new Error(`output_exists:${eventPath}`);
		const events: Record<string, unknown>[] = [];
		const log = (value: Record<string, unknown>) => {
			const e = { at: Date.now(), ...value };
			events.push(e);
			appendFileSync(eventPath, JSON.stringify(e) + "\n");
		};
		const f = fixture(name);
		const scope = {
			budgetId: campaign,
			runId: `emulator-${variant}`,
			configId: variant,
			jobId: `${root}:${name}`,
			pursuitId: null,
		};
		const meter = settings?.meter(scope, "subagent");
		const generator: LlmPort =
			role && meter
				? createRoleLlm(role, meter)
				: scripted(name, { think: variant === "productive" });
		const options: HostOptions = {
			directory,
			execution: variant as HostOptions["execution"],
			request: f.request,
			generator,
			web: f.web,
			limits: f.limits,
			log,
			...(baseline ? { baseline } : {}),
		};
		writeFileSync(
			join(directory, "input.json"),
			JSON.stringify(
				{
					name,
					variant,
					mode,
					role,
					...(useEvaluator ? { evaluator: evaluatorRole ?? "fixture" } : {}),
					request: f.request,
					limits: f.limits,
					sources: f.sources,
					provenance,
				},
				null,
				2,
			),
		);
		const started = performance.now();
		const host = await openExample(options);
		try {
			let run;
			try {
				run = await host.drive(signal.signal);
			} catch (error) {
				log({
					kind: "run_failed",
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
			const { view, markdown } = run;
			const elapsedMs = performance.now() - started;
			const snap = host.snapshot();
			let evaluation;
			if (useEvaluator) {
				log({ kind: "evaluation_started", pursuitId: host.coreId });
				const model =
					settings && evaluatorRole
						? evaluatorModel(
								createRoleLlm(
									evaluatorRole,
									settings.meter(
										{ ...scope, pursuitId: host.coreId },
										"evaluator",
									),
								),
							)
						: scriptedEvaluator;
				const result = snap.state.draft
					? await reviewReport(
							{
								pursuitId: host.coreId,
								request: f.request,
								report: snap.state.draft,
								documents: snap.documents,
							},
							model,
							signal.signal,
						)
					: null;
				writeFileSync(
					join(directory, "evaluation.json"),
					JSON.stringify(
						result ?? { status: "skipped", reason: "no_saved_report" },
						null,
						2,
					),
				);
				evaluation = {
					status: result?.status ?? "skipped",
					findings: result?.findings.length ?? 0,
					issues: result?.issues.map((issue) => issue.code) ?? [],
					durationMs: result?.durationMs ?? 0,
					model: result?.model,
					usage: result?.usage,
				};
				log({ kind: "evaluation_finished", ...evaluation });
				if (
					evaluation.status === "failed" ||
					evaluation.status === "expired" ||
					evaluation.status === "cancelled"
				)
					process.exitCode = 1;
			}
			const calls = events.filter((e) => e.kind === "model_finished");
			const add = (rows: typeof events, key: string) =>
				rows.reduce((sum, e) => sum + Number(e[key] ?? 0), 0);
			const callsOf = (purpose: string) =>
				calls.filter((c) => c.purpose === purpose).length;
			const toolCounts = Object.fromEntries(
				[...new Set(view.attempts.map((a) => a.tool))].map((tool) => [
					tool,
					view.attempts.filter((a) => a.tool === tool && a.state === "settled")
						.length,
				]),
			);
			const receiptReady = new Set<string>();
			let modelDuringIo = 0;
			for (const e of events) {
				if (e.kind === "job_started" && e.job !== "decision")
					receiptReady.add(String(e.id));
				if (
					(e.kind === "job_ready" || e.kind === "late_job_ignored") &&
					e.job !== "decision"
				)
					receiptReady.delete(String(e.id));
				if (e.kind === "model_started" && receiptReady.size) modelDuringIo++;
			}
			const stats = {
				name,
				variant,
				elapsedMs,
				status: view.status,
				verified: view.report?.verified ?? false,
				...(evaluation ? { evaluation } : {}),
				expectedComplete: f.expectedComplete,
				report: view.report,
				draft: snap.state.draft,
				markdown,
				model: {
					calls: calls.length,
					failed: events.filter((e) => e.kind === "model_failed").length,
					byPurpose: Object.fromEntries(
						["plan", "hypothesize", "propose", "review", "grade"].map((p) => [
							p,
							callsOf(p),
						]),
					),
					inputTokens: mode === "api" ? add(calls, "inputTokens") : null,
					cacheReadTokens:
						mode === "api" ? add(calls, "cacheReadTokens") : null,
					outputTokens: mode === "api" ? add(calls, "outputTokens") : null,
					durationMs: add(calls, "durationMs"),
					overlappingIo: modelDuringIo,
				},
				toolCounts,
				rejections: view.attempts
					.filter((a) => a.state === "rejected")
					.map((a) => ({ tool: a.tool, rules: a.rejection })),
				waitMs: add(
					events.filter((e) => e.kind === "wait"),
					"durationMs",
				),
				externalMs: add(
					events.filter(
						(e) =>
							e.kind === "job_ready" &&
							(e.job === "lookup" || e.job === "read"),
					),
					"durationMs",
				),
				markdownMs: add(
					events.filter(
						(e) =>
							(e.kind === "job_ready" && e.job === "markdown") ||
							e.kind === "markdown_published",
					),
					"durationMs",
				),
				usage: meter ? totalUsage(meter.events(scope.jobId)) : null,
			};
			writeFileSync(
				join(directory, "audit.json"),
				JSON.stringify(
					{
						stats,
						documents: snap.documents,
						attempts: view.attempts,
						decisions: view.decisions,
						verifications: view.verifications,
						progress: view.progress,
					},
					null,
					2,
				),
			);
			summary.push(stats);
			writeFileSync(
				join(root, "summary.json"),
				JSON.stringify(summary, null, 2),
			);
			console.log(
				`${variant} ${name}: ${view.status}, ${calls.length} model calls, ${(stats.elapsedMs / 1000).toFixed(2)} s` +
					(evaluation
						? `, evaluator ${evaluation.status} (${evaluation.findings} findings)`
						: ""),
			);
		} finally {
			await host.close();
		}
	}
} finally {
	settings?.close();
}
