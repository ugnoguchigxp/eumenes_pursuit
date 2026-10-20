/**
 * Live evaluation: Claude (generator/reviewer) and d1 on LARM (judge), real tools.
 *
 *   bun eval/main.ts run --name <run> [--conditions E0,E1,E2,E3] [--groups A,B,C,D,E]
 *       [--tasks id,..] [--repeat 1] [--generator generator|strong] [--language ja|en]
 *       [--adapter id@version] [--concurrency 2] [--policy config/policy.v1.json]
 *   bun eval/main.ts report --name <run>
 *
 * Results (gitignored): eval/results/<run>/{ledger.sqlite, runs.jsonl, summary.md}.
 * Task workspaces live in the OS temp directory (path printed per run).
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	createPursuitEngine,
	policySchema,
	terminalStatuses,
} from "../src/index.ts";
import { migrations } from "../src/sqlite.ts";
import { createClaudeLlm } from "../standalone/claude.ts";
import { openDecisionLease } from "../standalone/larm/connection.ts";
import { serialJudge } from "../standalone/larm/serial.ts";
import { openSettings } from "../standalone/settings.ts";
import { openStore } from "../standalone/store.ts";
import { conditionsFor, type ConditionName } from "./conditions.ts";
import type { EvalTask, ToolTier } from "./contracts.ts";
import {
	detection,
	isCorrect,
	measure,
	summarize,
	type RunRecord,
} from "./metrics.ts";
import { redactAcceptance, redactTools, secretValues } from "./redact.ts";
import { tasks } from "./tasks/index.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		name: { type: "string" },
		conditions: { type: "string", default: "E0,E1,E2,E3" },
		groups: { type: "string", default: "A,B,C,D,E" },
		tasks: { type: "string" },
		repeat: { type: "string", default: "1" },
		generator: { type: "string", default: "generator" },
		language: { type: "string", default: "ja" },
		adapter: { type: "string" },
		concurrency: { type: "string", default: "2" },
		policy: { type: "string", default: "config/policy.v1.json" },
		"max-steps": { type: "string", default: "250" },
		"keep-work": { type: "boolean", default: false },
		/** Exploration aids for group E: 0 none, 1 + exact calculator, 2 + offline references. */
		tools: { type: "string", default: "0" },
		/** Findings kept apart from hypotheses: off, verified, all (spec/findings-design.md). */
		findings: { type: "string", default: "off" },
		/** How a new strategy relates to earlier ones: free or distinct. */
		strategy: { type: "string", default: "free" },
		/** Self-assessment before leaving a strategy: off or parts (spec/persistence-design.md). */
		"self-check": { type: "string", default: "off" },
		/** When acceptance is checked: attempt or claim (spec/verification-design.md). */
		"verify-on": { type: "string", default: "attempt" },
		/** What a prediction states: status or falsifiable. */
		prediction: { type: "string", default: "status" },
		/** Before stepping back: off, or acceptance (re-read and judge each criterion). */
		"completion-check": { type: "string", default: "off" },
		/** Group E: add the in-loop referee tool review_draft. */
		critic: { type: "boolean", default: false },
	},
});
const command = positionals[0];
if (!values.name || !/^[A-Za-z0-9_.-]+$/.test(values.name))
	throw new Error("--name <run> is required (ASCII)");
const root = resolve(import.meta.dir, "results", values.name);
mkdirSync(root, { recursive: true });
const runsPath = resolve(root, "runs.jsonl");

/** The last record per task × condition × generator × repeat (a rerun replaces an errored one). */
function readRecords(): RunRecord[] {
	if (!existsSync(runsPath)) return [];
	const latest = new Map<string, RunRecord>();
	for (const line of readFileSync(runsPath, "utf8")
		.split("\n")
		.filter(Boolean)) {
		const r = JSON.parse(line) as RunRecord;
		latest.set(`${r.task}|${r.condition}|${r.generator}|${r.repeat}`, r);
	}
	return [...latest.values()];
}

function writeSummary() {
	const records = readRecords();
	const text = [
		`# ${values.name}`,
		"",
		`記録: ${records.length} 追求。fixture ではなく live（Claude API・本番 LARM d1・実道具）。`,
		"",
		summarize(records),
		"",
		"## 誤りを見抜く力（強制とは分けて）",
		"",
		detection(records),
		"",
	].join("\n");
	writeFileSync(resolve(root, "summary.md"), text);
	console.log(text);
}

if (command === "report") {
	writeSummary();
	process.exit(0);
}
if (command !== "run") throw new Error("usage: run | report");

const settings = openSettings();
const meter = settings.meter();
const pricing = settings.require("spend.pricing");
const generatorRole = settings.require(
	values.generator === "strong" ? "llm.strong" : "llm.generator",
);
const generator = createClaudeLlm(generatorRole, meter);
const reviewer = createClaudeLlm(settings.require("llm.reviewer"), meter);
const graderRole = settings.get("llm.grader");
const grader = graderRole ? createClaudeLlm(graderRole, meter) : null;
const toolTier = Number(values.tools) as ToolTier;
if (![0, 1, 2, 3].includes(toolTier))
	throw new Error("--tools must be 0, 1, 2 or 3");
/** Records are keyed by generator and tool tier, so tiers are compared side by side. */
const findings = values.findings as "off" | "verified" | "all";
if (!["off", "verified", "all"].includes(findings))
	throw new Error("--findings must be off, verified or all");
const strategyChange = values.strategy as "free" | "distinct";
if (!["free", "distinct"].includes(strategyChange))
	throw new Error("--strategy must be free or distinct");
const selfCheck = values["self-check"] as "off" | "parts";
if (!["off", "parts"].includes(selfCheck))
	throw new Error("--self-check must be off or parts");
const verifyOn = values["verify-on"] as "attempt" | "claim";
if (!["attempt", "claim"].includes(verifyOn))
	throw new Error("--verify-on must be attempt or claim");
const prediction = values.prediction as "status" | "falsifiable";
if (!["status", "falsifiable"].includes(prediction))
	throw new Error("--prediction must be status or falsifiable");
const completionCheck = values["completion-check"] as "off" | "acceptance";
if (!["off", "acceptance"].includes(completionCheck))
	throw new Error("--completion-check must be off or acceptance");
const policy = policySchema.parse(
	JSON.parse(readFileSync(values.policy!, "utf8")),
);
const variant = [
	`${values.generator}/T${toolTier}`,
	findings === "off" ? "" : `/F-${findings}`,
	strategyChange === "free" ? "" : "/S-distinct",
	policy.version === 1 ? "" : `/P-v${policy.version}`,
	values.critic ? "/C" : "",
	selfCheck === "off" ? "" : `/K-${selfCheck}`,
	verifyOn === "attempt" ? "" : `/V-${verifyOn}`,
	prediction === "status" ? "" : `/R-${prediction}`,
	completionCheck === "off" ? "" : `/A-${completionCheck}`,
].join("");
const secrets = secretValues(process.env);
const token = process.env.LARM_API_TOKEN;
if (!token) throw new Error("LARM_API_TOKEN is required");
const lease = openDecisionLease({
	origin: settings.require("larm.controlOrigin"),
	token,
	selector: settings.require("larm.decisionProfile"),
	audience: settings.require("larm.audience"),
	clientId: settings.require("larm.clientId"),
});
const store = openStore(resolve(root, "ledger.sqlite"), migrations);
let sequence = 0;
const engine = createPursuitEngine({
	store,
	clock: { now: () => Date.now() },
	ids: {
		next: (prefix) =>
			`${prefix}_${Date.now().toString(36)}_${(sequence++).toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
	},
	generator,
	reviewer,
	judge: serialJudge(lease.judge, { retries: 6, baseDelayMs: 150 }),
	onWarning: (code, detail) =>
		console.warn(`[warn] ${code}`, JSON.stringify(detail)),
});

const conditionNames = values.conditions!.split(",") as ConditionName[];
const adapter = values.adapter
	? {
			id: values.adapter.split("@")[0]!,
			version: Number(values.adapter.split("@")[1]),
		}
	: null;
const language = values.language === "en" ? "en" : "ja";
const groups = new Set(values.groups!.split(","));
const only = values.tasks ? new Set(values.tasks.split(",")) : null;
const selected = tasks.filter(
	(t) => groups.has(t.group) && (!only || only.has(t.id)),
);
const done = new Set(
	readRecords()
		.filter((r) => !r.error)
		.map((r) => `${r.task}|${r.condition}|${r.generator}|${r.repeat}`),
);
const jobs: { task: EvalTask; condition: ConditionName; repeat: number }[] = [];
for (let repeat = 1; repeat <= Number(values.repeat); repeat++)
	for (const condition of conditionNames)
		for (const task of selected)
			if (!done.has(`${task.id}|${condition}|${variant}|${repeat}`))
				jobs.push({ task, condition, repeat });
console.log(
	`jobs: ${jobs.length} (skipping ${done.size} already recorded); spent so far $${meter.spentUsd().toFixed(3)}`,
);

async function runOne(job: (typeof jobs)[number]) {
	const { task, condition, repeat } = job;
	const label = `${task.id}/${condition}/${variant}/#${repeat}`;
	const started = Date.now();
	// Outside the project, so task code cannot reach .env by a relative path.
	const directory = mkdtempSync(
		join(tmpdir(), `eumenes-pursuit-${task.id}-${condition}-${repeat}-`),
	);
	console.log(`[start] ${label} workspace ${directory}`);
	const instance = await task.create(directory, {
		grader,
		toolTier,
		critic: values.critic ? reviewer : null,
	});
	const controller = new AbortController();
	let pursuitId = "";
	let error: string | null = null;
	try {
		const startedPursuit = await engine.start(
			{
				goal: task.goalFor?.(toolTier) ?? task.goal,
				acceptance: task.acceptance,
				grant: task.grant,
				policy,
				conditions: conditionsFor(condition, {
					adapter,
					language,
					findings,
					strategyChange,
					selfCheck,
					verifyOn,
					prediction,
					completionCheck,
				}),
				goalRef: null,
				label: task.id,
			},
			// Every execution is a new pursuit; a rerun never resumes an old ledger entry.
			`${values.name}:${label}:${crypto.randomUUID()}`,
		);
		if (startedPursuit.replayed) throw new Error("unexpected_replay");
		pursuitId = startedPursuit.pursuitId;
		const runtime = {
			tools: redactTools(instance.tools, secrets),
			workspace: instance.workspace,
			acceptance: redactAcceptance(instance.acceptance, secrets),
		};
		for (let i = 0; i < Number(values["max-steps"]); i++) {
			const step = await engine.step(pursuitId, runtime, controller.signal);
			if (step.done) break;
			if (step.status === "awaiting_consultation") {
				const view = (await engine.view(pursuitId))!;
				const open = view.consultations.find((c) => c.answer === null)!;
				if (view.consultations.length > 3) {
					await engine.cancel(
						pursuitId,
						"相談が3回を超えました",
						runtime,
						controller.signal,
					);
					break;
				}
				await engine.answer(pursuitId, open.id, task.consultAnswer);
			}
		}
		const view = (await engine.view(pursuitId))!;
		if (!terminalStatuses.includes(view.status))
			await engine.cancel(
				pursuitId,
				"評価の手順数の上限",
				runtime,
				controller.signal,
			);
	} catch (e) {
		error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
		console.error(`[error] ${label}`, error);
	}
	const view = pursuitId ? await engine.view(pursuitId) : null;
	if (!view) return;
	const measured = measure(view, (model) => pricing[model]);
	const record: RunRecord = {
		...measured,
		run: values.name!,
		task: task.id,
		group: task.group,
		condition,
		generator: variant,
		level: task.level ?? null,
		repeat,
		expected: task.expected,
		correct: isCorrect(task.expected, { ...measured, error }),
		durationMs: Date.now() - started,
		error,
	};
	appendFileSync(runsPath, `${JSON.stringify(record)}\n`);
	if (!values["keep-work"]) await instance.dispose();
	console.log(
		`[done] ${label}: ${record.outcome}${record.verified ? " (verified)" : ""} correct=${record.correct} attempts=${record.attempts} stepBacks=${record.stepBacks} $${record.usd.toFixed(4)} ${Math.round(record.durationMs / 1000)}s`,
	);
}

try {
	const queue = [...jobs];
	await Promise.all(
		Array.from(
			{ length: Math.max(1, Number(values.concurrency)) },
			async () => {
				for (let job = queue.shift(); job; job = queue.shift()) {
					try {
						meter.assertWithinLimit();
					} catch (e) {
						console.error(String(e));
						queue.length = 0;
						return;
					}
					await runOne(job);
				}
			},
		),
	);
} finally {
	await lease.release();
	store.close();
	console.log(`spent so far $${meter.spentUsd().toFixed(3)}`);
	settings.close();
	writeSummary();
}
