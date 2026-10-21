/**
 * Procedural lessons from contrasting solved and unsolved pursuits (spec/lessons-design.md):
 *   bun eval/reflect.ts --runs persist-2,completion-1 --task e4-pi-squared-irrational --out eval/lessons/pi2.json
 * Pairs come from the same task × condition × variant. The reflector sees trajectories
 * only (strategies, parts, hypotheses, attempts, decisions), never proof text or grader reasons.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { PursuitView } from "../src/index.ts";
import { listPursuitIds, loadPursuit, migrations } from "../src/sqlite.ts";
import { createClaudeLlm } from "../standalone/claude.ts";
import { openSettings } from "../standalone/settings.ts";
import { openStore } from "../standalone/store.ts";
import type { RunRecord } from "./metrics.ts";

const { values } = parseArgs({
	options: {
		runs: { type: "string" },
		task: { type: "string" },
		out: { type: "string" },
		/** Pursuits per side of a contrast. */
		per: { type: "string", default: "2" },
		/** Contrast groups to reflect on, most balanced first. */
		groups: { type: "string", default: "4" },
	},
});
if (!values.runs || !values.task || !values.out)
	throw new Error("usage: --runs a,b --task <id> --out <file>");

/** Criterion ids from a refused claim may be quoted by the generator; they are grader output. */
const clip = (text: string, n: number) => {
	const clean = text.replace(/\[[A-Za-z0-9_.-]+\][^/\n]*/g, "[照合の結果]");
	return clean.length <= n ? clean : `${clean.slice(0, n)}…`;
};

interface Item {
	readonly record: RunRecord;
	readonly view: PursuitView;
}
const groups = new Map<string, { solved: Item[]; unsolved: Item[] }>();
for (const run of values.runs.split(",")) {
	const root = resolve(import.meta.dir, "results", run);
	const runsPath = resolve(root, "runs.jsonl");
	if (!existsSync(runsPath)) throw new Error(`no runs: ${runsPath}`);
	const store = openStore(resolve(root, "ledger.sqlite"), migrations);
	const views = new Map(
		(
			await store.readSnapshot((db) =>
				listPursuitIds(db).map((id) => loadPursuit(db, id)!),
			)
		).map((v) => [v.id, v]),
	);
	store.close();
	for (const line of readFileSync(runsPath, "utf8").split("\n")) {
		if (!line) continue;
		const record = JSON.parse(line) as RunRecord;
		const view = views.get(record.pursuitId);
		if (record.task !== values.task || record.error || !view) continue;
		// Under per-attempt checks the host, not the generator, decided "done": no contrast.
		if (!record.generator.includes("/V-claim")) continue;
		const key = `${run}|${record.condition}|${record.generator}`;
		const g = groups.get(key) ?? { solved: [], unsolved: [] };
		// Solved means the generator itself claimed and passed.
		(record.outcome === "completed" && record.verified
			? g.solved
			: g.unsolved
		).push({ record, view });
		groups.set(key, g);
	}
}

function trajectory(label: string, v: PursuitView): string {
	const lines = [`### ${label}`];
	for (const s of v.strategies) {
		lines.push(
			`方針${s.seq}: ${clip(s.body, 300)}${s.closeReason ? `（終了: ${clip(s.closeReason, 200)}）` : ""}`,
		);
		s.parts.forEach((p, i) => lines.push(`  部品${i + 1}: ${clip(p, 150)}`));
		for (const a of s.assessment ?? [])
			lines.push(
				`  自己評価 部品${a.part}: ${a.status} ${clip(a.evidence, 120)}${a.next ? ` / 次: ${clip(a.next, 120)}` : ""}`,
			);
		for (const h of v.hypotheses.filter((x) => x.strategyId === s.id)) {
			lines.push(
				`  仮説${h.seq}: ${clip(h.body, 200)} → ${clip(h.result ?? "試行中", 160)}`,
			);
			for (const a of v.attempts.filter((x) => x.hypothesisId === h.id)) {
				const what =
					a.state === "rejected"
						? `拒否(${(a.rejection ?? []).map((r) => r.rule).join(",")})`
						: `${a.observation?.status ?? "未観測"}${a.observation?.errorCode ? `(${a.observation.errorCode})` : ""}・${a.outcome === "success" ? "予測どおり" : "予測と違う"}`;
				lines.push(
					`    #${a.seq} ${a.tool}: 予測「${clip(a.prediction.expectedObservation, 100)}」→ ${what}`,
				);
			}
		}
	}
	lines.push(
		"判断の列: " +
			v.decisions.map((d) => `${d.seq}.${d.kind}(${d.decidedBy})`).join(" "),
	);
	lines.push(`結末: ${v.status}`);
	return lines.join("\n");
}

const reflection = z.strictObject({
	contrasts: z
		.array(
			z.strictObject({
				difference: z.string(),
				refs: z.string(),
				verdict: z.enum(["helped", "hurt", "no_effect", "confounded"]),
			}),
		)
		.max(6),
	lesson: z
		.strictObject({
			cue: z.string(),
			operation: z.string(),
			evidence: z.string(),
		})
		.nullable(),
	/** True when the candidate lesson would only make sense for this subject matter. */
	domainSpecific: z.boolean(),
});

const system = `You compare trajectories of an autonomous problem-solving loop on the same task under the same configuration. Some ended solved, some unsolved.
Find the decisive differences in PROCESS: how strategies were split into parts, when the deliverable was written, re-read or claimed, when the loop stepped back or gave up, how predictions and checks were used.
For each difference give the references (pursuit label and attempt # or decision #) and a verdict: helped, hurt, no_effect, or confounded (supported by only one pair, or several differences at once).
Then write at most ONE lesson as cue (the shape of the situation, not facts of this task) and operation (what to do there), with evidence (the references). The lesson must still make sense if the subject changed (e.g. from mathematics to a software or research task). Do not name theorems, formulas, constructions or any subject-matter content. Set domainSpecific true if you could not avoid that.
If every supporting difference is confounded, return lesson null (NO_ENTRY). Write in Japanese.`;

const settings = openSettings();
const meter = settings.meter();
const reflector = createClaudeLlm(settings.require("llm.grader"), meter);
const per = Number(values.per);
const chosen = [...groups]
	.filter(([, g]) => g.solved.length && g.unsolved.length)
	.sort(
		([, a], [, b]) =>
			Math.abs(a.solved.length - a.unsolved.length) -
			Math.abs(b.solved.length - b.unsolved.length),
	)
	.slice(0, Number(values.groups));

const results = [];
for (const [key, g] of chosen) {
	const solved = g.solved.slice(0, per);
	const unsolved = g.unsolved.slice(0, per);
	const prompt = [
		`## 構成\n${key}（解けた ${g.solved.length}・解けなかった ${g.unsolved.length}）`,
		"## 解けた追求",
		...solved.map((x, i) => trajectory(`S${i + 1}`, x.view)),
		"## 解けなかった追求",
		...unsolved.map((x, i) => trajectory(`U${i + 1}`, x.view)),
	].join("\n\n");
	const r = await reflector.complete(
		{
			purpose: "review",
			system,
			schema: reflection,
			maxOutputTokens: 4000,
			prompt,
		},
		AbortSignal.timeout(300_000),
	);
	const kept =
		r.value.lesson &&
		!r.value.domainSpecific &&
		r.value.contrasts.some((c) => c.verdict !== "confounded")
			? r.value.lesson
			: null;
	results.push({ group: key, ...r.value, kept });
	console.log(
		`${key}: ${kept ? `${kept.cue} → ${kept.operation}` : "NO_ENTRY"}`,
	);
}

// Overlapping lessons are merged into a few short ones, still free of subject matter.
const merging = z.strictObject({
	lessons: z
		.array(z.strictObject({ cue: z.string(), operation: z.string() }))
		.max(3),
});
const kept = results.flatMap((r) => (r.kept ? [r.kept] : []));
const merged = kept.length
	? (
			await reflector.complete(
				{
					purpose: "review",
					system: `Merge overlapping procedural lessons into at most three distinct ones. Each has a cue (the shape of the situation) and an operation (what to do), together under 200 Japanese characters. Remove every mention of subject matter (theorems, formulas, constructions, mathematical terms such as integrality, parity, boundary terms); keep only what would still apply to a software or research task. Keep only what several input lessons support. Write in Japanese.`,
					schema: merging,
					maxOutputTokens: 2000,
					prompt: kept
						.map((l, i) => `${i + 1}. ${l.cue} → ${l.operation}`)
						.join("\n"),
				},
				AbortSignal.timeout(300_000),
			)
		).value.lessons
	: [];
for (const l of merged) console.log(`merged: ${l.cue} → ${l.operation}`);

mkdirSync(dirname(resolve(values.out)), { recursive: true });
writeFileSync(
	resolve(values.out),
	`${JSON.stringify({ task: values.task, runs: values.runs.split(","), results, merged }, null, "\t")}\n`,
);
console.log(`spent so far $${meter.spentUsd().toFixed(3)}`);
