import type { RunRecord } from "./metrics.ts";

/** All scheduled attempts pay for their failures; missing/unknown costs stay unknown. */
export function efficiency(
	records: readonly RunRecord[],
	planned = records.length,
) {
	const correct = records.filter(
		(r) => r.correct && !r.error && !r.verificationIssue,
	).length;
	const known =
		records.length === planned && records.every((r) => r.usd !== null);
	const usd = known ? records.reduce((sum, r) => sum + r.usd!, 0) : null;
	const durationMs =
		records.length === planned
			? records.reduce((sum, r) => sum + r.durationMs, 0)
			: null;
	return {
		planned,
		recorded: records.length,
		correct,
		usd,
		durationMs,
		usdPerCorrect: correct && usd !== null ? usd / correct : null,
		msPerCorrect: correct && durationMs !== null ? durationMs / correct : null,
	};
}

/** A model's agreement with the host is not independent ground truth. */
export function verificationEvidence(input: {
	hostPassed: boolean;
	assurance: "exact" | "numeric" | "model" | null;
	independent?: { passed: boolean; basis: "exact" | "numeric" | "model" };
}) {
	const trusted = input.independent && input.independent.basis === "exact";
	return {
		hostPassed: input.hostPassed,
		assurance: input.assurance,
		independent: input.independent ?? null,
		falseAcceptance: trusted
			? input.hostPassed && !input.independent!.passed
			: null,
		falseRejection: trusted
			? !input.hostPassed && input.independent!.passed
			: null,
	};
}

export function efficiencyTable(
	records: readonly RunRecord[],
	planned: readonly import("./run-config.ts").PlannedJob[],
): string {
	const keys = new Map<
		string,
		{ condition: string; configId: string; planned: number }
	>();
	for (const job of planned) {
		const key = JSON.stringify([job.condition, job.configId]);
		const row = keys.get(key) ?? {
			condition: job.condition,
			configId: job.configId,
			planned: 0,
		};
		row.planned++;
		keys.set(key, row);
	}
	const show = (value: number | null, factor = 1) =>
		value === null ? "unknown" : (value / factor).toFixed(4);
	return [
		"| 条件 | configId | 記録/予定 | 正しい結末 | 全費用 USD | 総時間 分 | 総費用/正しい結末 | 総時間/正しい結末 分 |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
		...[...keys.values()].map((k) => {
			const e = efficiency(
				records.filter(
					(r) => r.condition === k.condition && r.configId === k.configId,
				),
				k.planned,
			);
			return `| ${k.condition} | ${k.configId} | ${e.recorded}/${e.planned} | ${e.correct} | ${show(e.usd)} | ${show(e.durationMs, 60000)} | ${show(e.usdPerCorrect)} | ${show(e.msPerCorrect, 60000)} |`;
		}),
		"",
		"失敗分と方式選択・レビューの費用を含む。欠落または未知費用はunknown。正しい結末0件では単価を定義しない。調査課題の正しい結末は観測の出典と数値の一致であり、自由記述の正しさや最適性ではない。",
		"偽の完了はホスト照合との整合性を測る指標であり、検証器の誤合格率ではない。model採点の合格・複数モデルの一致だけでは独立した真偽を確定しない。",
	].join("\n");
}
