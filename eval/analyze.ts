import { recordKey, recordVariant } from "./run-config.ts";
/**
 * Failure patterns from the ledger: bun eval/analyze.ts <run> [--group E]
 * Per pursuit: how it ended, which criteria failed at the end, what the process looked like.
 * Then per task × variant, so tool tiers can be compared side by side.
 * --strategies lists each pursuit's strategies, to see how varied the approaches were.
 * --depth compares variants by solve rate (Wilson 95%), partial credit and depth of work.
 * --horizon shows budget use, later-vs-earlier progress and returns to a construction (horizon-1).
 * --compare <run> [<run> …] puts pursuit and direct (D0) side by side over several runs
 *   (one run per condition × repeat in the ablation): bun eval/analyze.ts --compare abl-pursuit-r1 abl-direct-r1 …
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { listPursuitIds, loadPursuit, migrations } from "../src/sqlite.ts";
import type { PursuitView } from "../src/index.ts";
import { openStore } from "../standalone/store.ts";
import { ending, horizonRow } from "./horizon.ts";
import { compare, type RunRecord, verificationIssues } from "./metrics.ts";
import { tasks } from "./tasks/index.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		group: { type: "string" },
		"config-id": { type: "string" },
		"merge-configs": { type: "boolean", default: false },
		strategies: { type: "boolean", default: false },
		depth: { type: "boolean", default: false },
		/** Long-horizon measures (spec/long-horizon-design.md): budget use, progress, returns. */
		horizon: { type: "boolean", default: false },
		/** Pursuit vs direct over the runs named as positionals (runs.jsonl only, no ledger). */
		compare: { type: "boolean", default: false },
	},
});
if (values.compare) {
	if (!positionals.length)
		throw new Error("usage: bun eval/analyze.ts --compare <run> [<run> …]");
	const all: RunRecord[] = [];
	for (const name of positionals) {
		const path = resolve(import.meta.dir, "results", name, "runs.jsonl");
		if (!existsSync(path)) throw new Error(`no runs: ${path}`);
		const last = new Map<string, RunRecord>();
		for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
			const r = JSON.parse(line) as RunRecord;
			last.set(`${r.task}|${r.condition}|${r.generator}|${r.repeat}`, r);
		}
		all.push(...last.values());
	}
	console.log(
		[
			`# 追求と直接解法の比較: ${positionals.join(", ")}`,
			"",
			compare(all.filter((r) => !values.group || r.group === values.group)),
			"",
		].join("\n"),
	);
	process.exit(0);
}
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
	latest.set(recordKey(r), r);
}
const records = [...latest.values()].filter(
	(r) =>
		(!values.group || r.group === values.group) &&
		(!values["config-id"] || (r.configId ?? "legacy") === values["config-id"]),
);

if (
	new Set(records.map((r) => r.configId ?? "legacy")).size > 1 &&
	!values["merge-configs"]
)
	throw new Error(
		"multiple configs: select --config-id <id> or explicitly --merge-configs",
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
		`| ${r.task} | ${recordVariant(r)} | ${r.condition} | ${end} | ${failed.join(", ") || "-"} | ${r.failedClaims} | ${
			Object.entries(r.rejectionsByRule)
				.map(([k, n]) => `${k}×${n}`)
				.join(" ") || "-"
		} | ${r.stepBacks} | ${toolUse(v) || "-"} | ${r.usd === null ? "unknown" : `$${r.usd.toFixed(3)}${r.usage?.costStatus === "estimated" ? " (estimated)" : !r.usage ? " (legacy)" : ""}`} |`,
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
// Final verification unfinished: whether the work passed is unknown (spec/fixes-2026-10-22.md §h).
const unfinished = records.filter((r) => r.verificationIssue);
if (unfinished.length)
	lines.push(
		"",
		`## 最終照合が終わっていない追求（保留/中止/失敗 = ${verificationIssues(unfinished)}）`,
		"合否が分からないため、照合の通過数と区間の分母から除く。",
		...unfinished.map(
			(r) =>
				`- ${r.task} ${recordVariant(r)} #${r.repeat}: ${r.outcome}、最終照合 ${r.verificationIssue}`,
		),
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
		const key = `${r.task} ${recordVariant(r)}`;
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

/** n, or "judged (+k 未了)" when some final verifications did not finish. */
const nJudged = (n: number, judged: number) =>
	n === judged ? `${n}` : `${judged} (+${n - judged} 未了)`;

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
	const ids = failed
		.replace(/（.*$/, "")
		.split(", ")
		.filter((id) => id !== "総合");
	return ids.length ? Math.max(0, (size - ids.length) / size) : 0;
}

if (values.depth) {
	const size = new Map(tasks.map((t) => [t.id, t.rubricSize ?? 0]));
	const groups = new Map<string, RunRecord[]>();
	for (const r of records) {
		const key = `${r.task}|${r.condition}|${recordVariant(r)}`;
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
		const judged = rs.filter((r) => !r.verificationIssue).length;
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
			`| ${task} | ${condition} | ${variant} | ${nJudged(rs.length, judged)} | ${solved} | ${wilson(solved, judged)} | ${
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

if (values.horizon) {
	const size = new Map(tasks.map((t) => [t.id, t.rubricSize ?? 0]));
	const f2 = (x: number | null) => (x === null ? "-" : x.toFixed(2));
	const avg = (xs: (number | null)[]) => {
		const ys = xs.filter((x): x is number => x !== null);
		return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
	};
	const sorted = [...records].sort((a, b) =>
		`${a.task}${a.generator}${a.repeat}`.localeCompare(
			`${b.task}${b.generator}${b.repeat}`,
		),
	);
	const rows = sorted.flatMap((r) => {
		const v = views.get(r.pursuitId);
		return v ? [{ r, v, h: horizonRow(r, v) }] : [];
	});
	const out = [
		"",
		"## 長い予算（追求ごと）",
		"| 課題 | 構成 | # | 結末 | 当たった予算 | 試行の使用 | 方針の使用 | 一段上への使用 | 手順の使用 | 時間の使用 | 部分点 | 前半の済み | 後半の済み | 差 | 戻り（類似の最大） |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...rows.map(
			({ r, v, h }) =>
				`| ${r.task} | ${recordVariant(r)} | ${r.repeat} | ${h.ending} | ${h.budgetStop ?? "-"} | ${f2(h.use.attempts)} | ${f2(h.use.strategies)} | ${f2(h.use.stepBacks)} | ${f2(h.use.transitions)} | ${f2(h.use.wall)} | ${
					size.get(r.task) ? f2(rubricScore(v, size.get(r.task)!)) : "-"
				} | ${f2(h.progress.earlier)} | ${f2(h.progress.later)} | ${f2(h.progress.gain)} | ${h.returns.count} (${h.returns.maxSimilarity.map((x) => x.toFixed(2)).join(" ") || "-"}) |`,
		),
		"",
		"## 長い予算（課題 × 構成）",
		"| 課題 | 構成 | n | 通過 | 95% 区間 | 部分点 | 試行の使用 | 最大の使用 | 前進（差の平均） | 戻り（合計） | 終わり方 | 終わりに残った試行予算 |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	const groups = new Map<string, typeof rows>();
	for (const row of rows) {
		const key = `${row.r.task}|${recordVariant(row.r)}`;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	for (const [key, rs] of [...groups].sort((a, b) =>
		a[0].localeCompare(b[0]),
	)) {
		const [task, variant] = key.split("|") as [string, string];
		const solved = rs.filter(
			({ r }) => r.verified && r.outcome === "completed",
		).length;
		const judged = rs.filter(({ r }) => !r.verificationIssue).length;
		const endings = new Map<string, number>();
		for (const { h } of rs)
			endings.set(h.ending, (endings.get(h.ending) ?? 0) + 1);
		out.push(
			`| ${task} | ${variant} | ${nJudged(rs.length, judged)} | ${solved} | ${wilson(solved, judged)} | ${
				size.get(task)
					? f2(avg(rs.map(({ v }) => rubricScore(v, size.get(task)!))))
					: "-"
			} | ${f2(avg(rs.map(({ h }) => h.use.attempts)))} | ${f2(avg(rs.map(({ h }) => h.use.max)))} | ${f2(
				avg(rs.map(({ h }) => h.progress.gain)),
			)} | ${rs.reduce((n, { h }) => n + h.returns.count, 0)} | ${[...endings]
				.map(([e, n]) => `${e}×${n}`)
				.join(" ")} | ${f2(avg(rs.map(({ h }) => 1 - h.use.attempts)))} |`,
		);
	}
	console.log(out.join("\n"));
}
