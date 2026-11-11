/** Print pursuit history from a benchmark run or an existing host ledger. */
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { LedgerDb } from "../src/contracts/index.ts";
import { listPursuitIds, loadPursuit, migrations } from "../src/sqlite.ts";
import { openStore } from "../standalone/store.ts";

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: { ledger: { type: "string" } },
});
const [run, filter] = values.ledger ? [null, positionals[0]] : positionals;
if ((!run && !values.ledger) || positionals.length > (values.ledger ? 1 : 2))
	throw new Error(
		"usage: bun eval/trace.ts <run> [pursuitId|task] | --ledger <path> [pursuitId|task]",
	);
const load = (db: LedgerDb) =>
	listPursuitIds(db)
		.map((id) => loadPursuit(db, id)!)
		.filter((v) => !filter || v.id === filter || v.input.label === filter);
async function loadViews() {
	if (values.ledger) {
		const db = new Database(resolve(values.ledger), {
			readonly: true,
			strict: true,
		});
		try {
			return db.transaction(() => load(db)).deferred();
		} finally {
			db.close();
		}
	}
	const store = openStore(
		resolve(import.meta.dir, "results", run!, "ledger.sqlite"),
		migrations,
	);
	try {
		return await store.readSnapshot(load);
	} finally {
		store.close();
	}
}
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
for (const v of await loadViews()) {
	console.log(
		`\n=== ${v.input.label} ${v.id} → ${v.status} ${v.report ? `verified=${v.report.verified} 「${clip(v.report.reason)}」` : ""}`,
	);
	const c = v.input.conditions;
	console.log(
		`conditions rules=${c.rules} judge=${c.judge} review=${c.review} lang=${c.language}`,
	);
	for (const s of v.strategies) {
		console.log(
			`方針${s.seq}: ${clip(s.body)}${s.closeReason ? ` [終了: ${clip(s.closeReason, 80)}]` : ""}`,
		);
		for (const h of v.hypotheses.filter((h) => h.strategyId === s.id)) {
			console.log(
				`  仮説${h.seq}: ${clip(h.body)} → ${clip(h.result ?? "active", 80)}`,
			);
			for (const a of v.attempts.filter((a) => a.hypothesisId === h.id)) {
				const js = v.judgements
					.filter((j) => j.attemptId === a.id)
					.map((j) => {
						const ans = j.answer;
						const val =
							ans.type === "noul"
								? ans.pYes.toFixed(2)
								: ans.type === "choice"
									? ans.choice
									: ans.score.toFixed(2);
						return `${j.questionId}=${val}${j.fired ? (j.usable ? "!" : "?") : ""}`;
					});
				console.log(
					`    #${a.seq} [${a.state}${a.outcome ? `/${a.outcome}` : ""}] ${a.tool} ${clip(JSON.stringify(a.input), 100)}`,
				);
				console.log(
					`       予測: ${a.prediction.expectedStatus} ${clip(a.prediction.expectedObservation, 100)}`,
				);
				if (a.observation)
					console.log(
						`       観測: ${a.observation.status}${a.observation.errorCode ? `(${a.observation.errorCode})` : ""} ${clip(JSON.stringify(a.observation.output), 120)}`,
					);
				if (a.rejection)
					console.log(
						`       拒否: ${a.rejection.map((r) => `${r.rule}`).join(", ")}`,
					);
				if (a.features)
					console.log(
						`       特徴: files=${a.features.filesTouched.length} lines=${a.features.linesChanged} protected=${a.features.protectedTouched.length} match=${a.features.match?.toFixed(2) ?? "-"} progress=${a.features.progress?.toFixed(2) ?? "-"}`,
					);
				if (js.length) console.log(`       判定: ${js.join(" ")}`);
			}
		}
	}
	for (const d of v.decisions)
		console.log(
			`判断${d.seq}: ${d.kind} by ${d.decidedBy} 「${clip(d.reason, 120)}」 ${clip(JSON.stringify(d.basis), 160)}`,
		);
	for (const p of v.progress ?? []) {
		const { verdict, choice } = p;
		const attempts = (seqs: readonly number[]) =>
			seqs.map((seq) => `#${seq}`).join(",") || "-";
		console.log(
			`進展 ${p.id} [${p.assurance}/${p.status ?? "記録済み"}] ${verdict.kind} → ${choice.choice}/${choice.route}`,
		);
		console.log(
			`  評価した試行: ${attempts(verdict.assessed)} / 根拠: ${attempts(verdict.evidence)} / 条件: ${verdict.criteria.join(",") || "-"}`,
		);
		console.log(
			`  変化: ${clip(verdict.change)} / 判断理由: ${clip(choice.reason)}`,
		);
		if (p.reusedArtifact)
			console.log(
				`  再利用した保存・読戻し: ${attempts([p.reusedArtifact.write, p.reusedArtifact.readBack])}`,
			);
	}
	for (const check of v.verifications)
		console.log(
			`照合 ${check.trigger} ${check.passed ? "合格" : "不合格"}: ${check.criteria.map((c) => `${c.id}=${c.passed ? "合格" : "不合格"}(${c.assurance ?? "exact"})`).join(", ")}`,
		);
	for (const q of v.consultations)
		console.log(
			`相談: ${clip(q.question, 120)} → ${clip(q.answer ?? "未回答", 80)}`,
		);
	const rj = v.judgements.filter((j) => j.stage === "review");
	if (rj.length)
		console.log(
			`振り返りの判定: ${rj.map((j) => (j.answer.type === "choice" ? `${j.answer.choice}(${j.answer.confidence.toFixed(2)})` : "")).join(" ")}`,
		);
	const inf = v.inference;
	console.log(
		`推論: LLM ${inf.filter((i) => !i.purpose.startsWith("judge")).length}回 / d1 ${inf.filter((i) => i.purpose.startsWith("judge")).length}回 平均${Math.round(inf.filter((i) => i.purpose.startsWith("judge")).reduce((s, i) => s + i.latencyMs, 0) / Math.max(1, inf.filter((i) => i.purpose.startsWith("judge")).length))}ms`,
	);
}
