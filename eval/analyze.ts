/**
 * Failure patterns from the ledger: bun eval/analyze.ts <run> [--group E]
 * Per pursuit: how it ended, which criteria failed at the end, what the process looked like.
 * Then per task × variant, so tool tiers can be compared side by side.
 * --strategies lists each pursuit's strategies, to see how varied the approaches were.
 * --depth compares variants by solve rate (Wilson 95%), partial credit and depth of work.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { listPursuitIds, loadPursuit, migrations } from "../src/sqlite.ts";
import type { PursuitView } from "../src/index.ts";
import { openStore } from "../standalone/store.ts";
import { isForcedStop, type RunRecord } from "./metrics.ts";
import { tasks } from "./tasks/index.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		group: { type: "string" },
		strategies: { type: "boolean", default: false },
		depth: { type: "boolean", default: false },
	},
});
const run = positionals[0];
if (!run)
	throw new Error(
		"usage: bun eval/analyze.ts <run> [--group E] [--strategies]",
	);
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

if (values.strategies) {
	const out = ["", "## 方針の一覧"];
	const counts = new Map<string, number[]>();
	for (const r of [...records].sort((a, b) =>
		`${a.task}${a.generator}${a.repeat}`.localeCompare(
			`${b.task}${b.generator}${b.repeat}`,
		),
	)) {
		const v = views.get(r.pursuitId);
		const key = `${r.task} ${r.generator}`;
		counts.set(key, [...(counts.get(key) ?? []), v?.strategies.length ?? 0]);
		out.push(`### ${key} #${r.repeat}（${ending(r, v)}）`);
		for (const st of v?.strategies ?? [])
			out.push(
				`- 方針${st.seq}: ${st.body.replace(/\s+/g, " ").slice(0, 160)}`,
			);
	}
	out.push(
		"",
		"## 追求あたりの方針の数",
		"| 課題 × 構成 | 平均 | 内訳 |",
		"| --- | --- | --- |",
	);
	for (const [k, ns] of counts)
		out.push(
			`| ${k} | ${(ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1)} | ${ns.join(" ")} |`,
		);
	console.log(out.join("\n"));
}

/** Wilson score interval at 95%, as percentages. */
function wilson(k: number, n: number): string {
	if (!n) return "-";
	const z = 1.96;
	const p = k / n;
	const d = 1 + (z * z) / n;
	const c = (p + (z * z) / (2 * n)) / d;
	const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
	return `${Math.round(Math.max(0, c - h) * 100)}–${Math.round(Math.min(1, c + h) * 100)}%`;
}

/**
 * Share of rubric items passed in the final grading. 0 when nothing gradable was
 * submitted, and also when only the overall verdict failed (no item ids to count).
 */
function rubricScore(v: PursuitView | undefined, size: number): number {
	const sound = v?.verifications
		.filter((x) => x.trigger === "final")
		.at(-1)
		?.criteria.find((c) => c.id === "proof-sound");
	if (!sound) return 0;
	if (sound.passed) return 1;
	const failed = /^不合格の基準: (.*)$/.exec(sound.evidence)?.[1];
	if (!failed) return 0;
	const ids = failed.split(", ").filter((id) => id !== "総合");
	return ids.length ? Math.max(0, (size - ids.length) / size) : 0;
}

if (values.depth) {
	const size = new Map(tasks.map((t) => [t.id, t.rubricSize ?? 0]));
	const groups = new Map<string, RunRecord[]>();
	for (const r of records) {
		const key = `${r.task}|${r.condition}|${r.generator}`;
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	const mean = (xs: number[]) =>
		xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-";
	const out = [
		"",
		"## 深さと部分点",
		"| 課題 | 条件 | 構成 | n | 照合を通過 | 95% 区間 | 部分点 | 証明を書いた回数 | 方針の数 | 方針1 での試行 | 断念 / 停止 | 申告（通過 / 全体） | 申告漏れ |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const [key, rs] of [...groups].sort((a, b) =>
		a[0].localeCompare(b[0]),
	)) {
		const [task, condition, variant] = key.split("|") as [
			string,
			string,
			string,
		];
		const vs = rs.map((r) => views.get(r.pursuitId));
		const solved = rs.filter(
			(r) => r.verified && r.outcome === "completed",
		).length;
		// The final check passed but nobody claimed completion (spec/verification-design.md §1).
		const missed = rs.filter(
			(r) => r.verified && r.outcome !== "completed",
		).length;
		const claims = vs.flatMap((v) =>
			(v?.verifications ?? []).filter((x) => x.trigger === "claim"),
		);
		const real = (v: PursuitView | undefined) =>
			(v?.attempts ?? []).filter((a) => a.state !== "rejected");
		const firstStrategy = vs.map((v) => {
			const s1 = v?.strategies[0]?.id;
			const hyps = new Set(
				(v?.hypotheses ?? [])
					.filter((h) => h.strategyId === s1)
					.map((h) => h.id),
			);
			return real(v).filter((a) => hyps.has(a.hypothesisId)).length;
		});
		const endings = rs.map((r, i) => ending(r, vs[i]));
		out.push(
			`| ${task} | ${condition} | ${variant} | ${rs.length} | ${solved} | ${wilson(solved, rs.length)} | ${
				size.get(task)
					? mean(vs.map((v) => rubricScore(v, size.get(task)!)))
					: "-"
			} | ${mean(vs.map((v) => real(v).filter((a) => a.tool === "write_proof").length))} | ${mean(
				vs.map((v) => v?.strategies.length ?? 0),
			)} | ${mean(firstStrategy)} | ${endings.filter((e) => e === "gave_up").length} / ${
				endings.filter((e) => e.startsWith("stopped_by")).length
			} | ${claims.filter((c) => c.passed).length} / ${claims.length} | ${missed} |`,
		);
	}
	console.log(out.join("\n"));
}
