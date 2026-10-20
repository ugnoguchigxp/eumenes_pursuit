/**
 * Failure patterns from the ledger: bun eval/analyze.ts <run> [--group E]
 * Per pursuit: how it ended, which criteria failed at the end, what the process looked like.
 * Then per task × variant, so tool tiers can be compared side by side.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { listPursuitIds, loadPursuit, migrations } from "../src/sqlite.ts";
import type { PursuitView } from "../src/index.ts";
import { openStore } from "../standalone/store.ts";
import { isForcedStop, type RunRecord } from "./metrics.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { group: { type: "string" } },
});
const run = positionals[0];
if (!run) throw new Error("usage: bun eval/analyze.ts <run> [--group E]");
const root = resolve(import.meta.dir, "results", run);
const runsPath = resolve(root, "runs.jsonl");
if (!existsSync(runsPath)) throw new Error(`no runs: ${runsPath}`);
// The last record per task × condition × variant × repeat: a rerun replaces an errored one.
const latest = new Map<string, RunRecord>();
for (const line of readFileSync(runsPath, "utf8").split("\n").filter(Boolean)) {
	const r = JSON.parse(line) as RunRecord;
	latest.set(`${r.task}|${r.condition}|${r.generator}|${r.repeat}`, r);
}
const records = [...latest.values()].filter(
	(r) => !values.group || r.group === values.group,
);

const store = openStore(resolve(root, "ledger.sqlite"), migrations);
const views = new Map<string, PursuitView>(
	(
		await store.readSnapshot((db) =>
			listPursuitIds(db).map((id) => loadPursuit(db, id)!),
		)
	).map((v) => [v.id, v]),
);
store.close();

/** How the pursuit ended, as a stable class rather than free text. */
function ending(r: RunRecord, v: PursuitView | undefined): string {
	if (r.error) return "harness_error";
	if (r.outcome === "completed")
		return r.verified ? "verified" : "claimed_unverified";
	if (isForcedStop(r.reason))
		return r.reason.includes("試行") ? "budget_attempts" : "forced_stop";
	const last = v?.decisions.at(-1);
	if (r.outcome === "incomplete") return "gave_up";
	return `stopped_by_${last?.decidedBy ?? "unknown"}`;
}

function failedCriteria(v: PursuitView | undefined): string[] {
	const final = v?.verifications.filter((x) => x.trigger === "final").at(-1);
	return final?.criteria.filter((c) => !c.passed).map((c) => c.id) ?? [];
}

function toolUse(v: PursuitView | undefined): string {
	const counts = new Map<string, { n: number; errors: number }>();
	for (const a of v?.attempts ?? []) {
		if (a.state === "rejected") continue;
		const c = counts.get(a.tool) ?? { n: 0, errors: 0 };
		c.n++;
		if (a.observation?.status === "error") c.errors++;
		counts.set(a.tool, c);
	}
	return [...counts]
		.map(([t, c]) => `${t}×${c.n}${c.errors ? `(err${c.errors})` : ""}`)
		.join(" ");
}

const lines = [
	`# 失敗の傾向: ${run}${values.group ? `（群 ${values.group}）` : ""}`,
	"",
	"| 課題 | 段階 | 条件 | 結末 | 最後に落ちた基準 | 申告の不合格 | 拒否 | 一段上へ | 道具 | 費用 |",
	"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
const byEnding = new Map<string, number>();
const byCriterion = new Map<string, number>();
for (const r of [...records].sort((a, b) =>
	`${a.task}${a.generator}${a.condition}`.localeCompare(
		`${b.task}${b.generator}${b.condition}`,
	),
)) {
	const v = views.get(r.pursuitId);
	const end = ending(r, v);
	const failed = failedCriteria(v);
	byEnding.set(end, (byEnding.get(end) ?? 0) + 1);
	for (const c of failed) byCriterion.set(c, (byCriterion.get(c) ?? 0) + 1);
	lines.push(
		`| ${r.task} | ${r.generator.split("/")[1] ?? "-"} | ${r.condition} | ${end} | ${failed.join(", ") || "-"} | ${r.failedClaims} | ${
			Object.entries(r.rejectionsByRule)
				.map(([k, n]) => `${k}×${n}`)
				.join(" ") || "-"
		} | ${r.stepBacks} | ${toolUse(v) || "-"} | $${r.usd.toFixed(3)} |`,
	);
}
lines.push(
	"",
	"## 結末の分類",
	...[...byEnding].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`),
	"",
	"## 最後に落ちた基準",
	...[...byCriterion]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `- ${k}: ${n}`),
);
console.log(lines.join("\n"));
