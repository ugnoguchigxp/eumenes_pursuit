import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LlmPort } from "../../src/index.ts";
import { createRoleLlm } from "../../standalone/llm.ts";
import { openSettings } from "../../standalone/settings.ts";
import { totalUsage } from "../../standalone/usage.ts";
import { cases, fixture, scripted, type Case } from "./fixtures.ts";
import { openExample, type HostOptions } from "./host.ts";
import provenance from "./provenance.json";

const [
	mode = "fixture",
	variant = "productive",
	selection = "museum",
	output = "artifacts/eumenes-example",
	baselinePath,
] = process.argv.slice(2);
if (
	!["fixture", "api"].includes(mode) ||
	!["legacy", "productive"].includes(variant)
)
	throw new Error(
		"Usage: bun examples/eumenes/run.ts fixture|api legacy|productive case[,case] output-dir [baseline-source-dir]",
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
		const meter = settings?.meter(
			{
				budgetId: campaign,
				runId: `emulator-${variant}`,
				configId: variant,
				jobId: `${root}:${name}`,
				pursuitId: null,
			},
			"subagent",
		);
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
			const snap = host.snapshot();
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
				elapsedMs: performance.now() - started,
				status: view.status,
				verified: view.report?.verified ?? false,
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
				usage: meter ? totalUsage(meter.events(`${root}:${name}`)) : null,
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
				`${variant} ${name}: ${view.status}, ${calls.length} model calls, ${(stats.elapsedMs / 1000).toFixed(2)} s`,
			);
		} finally {
			await host.close();
		}
	}
} finally {
	settings?.close();
}
