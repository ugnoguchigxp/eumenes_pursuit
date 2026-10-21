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
import { createFileLlm } from "../standalone/file-llm.ts";
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
import { loadSecret } from "./tasks/e/discovery.ts";
import { loadRubric } from "./tasks/e/proof-grader.ts";
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
		/** Procedural lessons file from eval/reflect.ts, given as StartInput.experience. */
		lessons: { type: "string" },
		/** Group E: add the in-loop referee tool review_draft. */
		critic: { type: "boolean", default: false },
		/** LLM port: claude (API) or file (an outside responder answers request files). */
		llm: { type: "string", default: "claude" },
		/** Directory for --llm file (requests/ and responses/). */
		"llm-dir": { type: "string", default: "/workspace/pursuit_llm" },
		/** Directory for the reviewer with --llm file; defaults to --llm-dir. A separate one keeps review in its own responder. */
		"reviewer-dir": { type: "string" },
		/** Grader port for proofs: claude (settings llm.grader), file (a separate responder), or none. */
		"grader-llm": { type: "string" },
		/** Directory for --grader-llm file; must differ from --llm-dir (a different responder). */
		"grader-dir": { type: "string", default: "/workspace/pursuit_grader" },
		/** Grader-only directory of external proof rubrics (<id>.json) for tasks with a rubricId; keep it outside every responder's directory. */
		"rubric-dir": { type: "string" },
		/** Host-only directory of expected answers (<id>.json) for discovery tasks with a secretId; outside every responder's directory. */
		"secret-dir": { type: "string" },
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

/** What actually answered: from the recorded variants and conditions, not from this invocation's flags. */
function describeLive(records: RunRecord[]): string {
	const llm = new Set(
		records.map((r) =>
			r.generator.includes("/LLM-file") ? "ファイル経由の応答者" : "Claude API",
		),
	);
	const graders = new Set(
		records.flatMap((r) =>
			r.generator.includes("/G-file") ? ["採点はファイル経由"] : [],
		),
	);
	const judged = records.some(
		(r) => !["E0", "E1", "E1R"].includes(r.condition),
	);
	const conditions = [...new Set(records.map((r) => r.condition))].join("・");
	return [
		`LLM: ${[...llm].join("・") || "-"}`,
		...graders,
		judged ? "本番 LARM d1" : "判定層なし",
		`条件 ${conditions || "-"}`,
	].join("・");
}

function writeSummary() {
	const records = readRecords();
	const text = [
		`# ${values.name}`,
		"",
		`記録: ${records.length} 追求。fixture ではなく live（${describeLive(records)}・実道具）。`,
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
const useFile = values.llm === "file";
if (!["claude", "file"].includes(values.llm!))
	throw new Error("--llm must be claude or file");
const fileLlm = (role: string) =>
	createFileLlm({ dir: values["llm-dir"]!, role });
const generator = useFile
	? fileLlm(values.generator!)
	: createClaudeLlm(generatorRole, meter);
const reviewer = useFile
	? createFileLlm({
			dir: values["reviewer-dir"] ?? values["llm-dir"]!,
			role: "reviewer",
		})
	: createClaudeLlm(settings.require("llm.reviewer"), meter);
const graderRole = settings.get("llm.grader");
// Default: claude when --llm claude; none when --llm file (the generator's responder must not grade itself).
const graderMode = values["grader-llm"] ?? (useFile ? "none" : "claude");
if (!["claude", "file", "none"].includes(graderMode))
	throw new Error("--grader-llm must be claude, file or none");
if (
	graderMode === "file" &&
	useFile &&
	resolve(values["grader-dir"]!) === resolve(values["llm-dir"]!)
)
	throw new Error("--grader-dir must differ from --llm-dir");
if (
	graderMode === "file" &&
	useFile &&
	values["reviewer-dir"] &&
	resolve(values["grader-dir"]!) === resolve(values["reviewer-dir"])
)
	throw new Error("--grader-dir must differ from --reviewer-dir");
const grader =
	graderMode === "file"
		? createFileLlm({ dir: values["grader-dir"]!, role: "grader" })
		: graderMode === "claude" && graderRole
			? createClaudeLlm(graderRole, meter)
			: null;
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
/** The kept lessons, as "cue → operation" lines (spec/lessons-design.md). */
const lessonsFile = values.lessons
	? (JSON.parse(readFileSync(values.lessons, "utf8")) as {
			task: string;
			merged?: { cue: string; operation: string }[];
		})
	: null;
if (lessonsFile && !lessonsFile.merged)
	throw new Error("--lessons file has no merged lessons");
// Lessons are measured on held-out tasks only, never on the task they came from.
if (lessonsFile && values.tasks?.split(",").includes(lessonsFile.task))
	throw new Error(
		`--lessons comes from ${lessonsFile.task}; use held-out tasks`,
	);
const experience = lessonsFile
	? lessonsFile
			.merged!.map((l) => `${l.cue} → ${l.operation}`)
			.slice(0, 5)
			.map((line) => line.slice(0, 300))
	: [];
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
	useFile ? "/LLM-file" : "",
	graderMode === "file" ? "/G-file" : "",
	values.lessons
		? `/L-${values.lessons
				.split("/")
				.at(-1)!
				.replace(/\.json$/, "")}`
		: "",
].join("");
const secrets = secretValues(process.env);
const conditionNames = values.conditions!.split(",") as ConditionName[];
// E0, E1 and E1R never ask the judge, so they run without LARM.
const needsJudge = conditionNames.some((c) => !["E0", "E1", "E1R"].includes(c));
const token = process.env.LARM_API_TOKEN;
if (needsJudge && !token) throw new Error("LARM_API_TOKEN is required");
const lease = needsJudge
	? openDecisionLease({
			origin: settings.require("larm.controlOrigin"),
			token: token!,
			selector: settings.require("larm.decisionProfile"),
			audience: settings.require("larm.audience"),
			clientId: settings.require("larm.clientId"),
		})
	: null;
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
	judge: lease
		? serialJudge(lease.judge, { retries: 6, baseDelayMs: 150 })
		: null,
	onWarning: (code, detail) =>
		console.warn(`[warn] ${code}`, JSON.stringify(detail)),
});

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
const rubricDir = values["rubric-dir"] ? resolve(values["rubric-dir"]) : null;
const secretDir = values["secret-dir"] ? resolve(values["secret-dir"]) : null;
const responderDirs = [
	values["llm-dir"],
	values["reviewer-dir"],
	values["grader-dir"],
]
	.filter((d): d is string => !!d)
	.map((d) => resolve(d));
const overlaps = (dir: string) =>
	responderDirs.some(
		(d) => dir === d || dir.startsWith(`${d}/`) || d.startsWith(`${dir}/`),
	);
const secretTasks = selected.filter((t) => t.secretId);
if (secretTasks.length) {
	if (!secretDir)
		throw new Error(
			`${secretTasks.map((t) => t.id).join(",")} need --secret-dir`,
		);
	if (overlaps(secretDir))
		throw new Error("--secret-dir must be outside every responder directory");
	for (const t of secretTasks) await loadSecret(secretDir, t.secretId!);
}
const rubricTasks = selected.filter((t) => t.rubricId);
if (rubricTasks.length) {
	if (!grader)
		throw new Error(
			`${rubricTasks.map((t) => t.id).join(",")} need a grader (--grader-llm file|claude)`,
		);
	if (!rubricDir)
		throw new Error(
			`${rubricTasks.map((t) => t.id).join(",")} need --rubric-dir`,
		);
	const responderDirs = [
		values["llm-dir"],
		values["reviewer-dir"],
		values["grader-dir"],
	]
		.filter((d): d is string => !!d)
		.map((d) => resolve(d));
	if (
		responderDirs.some(
			(d) =>
				rubricDir === d ||
				rubricDir.startsWith(`${d}/`) ||
				d.startsWith(`${rubricDir}/`),
		)
	)
		throw new Error("--rubric-dir must be outside every responder directory");
	for (const t of rubricTasks) await loadRubric(rubricDir, t.rubricId!);
}
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
		rubricDir,
		secretDir,
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
				...(experience.length ? { experience } : {}),
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
	await lease?.release();
	store.close();
	console.log(`spent so far $${meter.spentUsd().toFixed(3)}`);
	settings.close();
	writeSummary();
}
