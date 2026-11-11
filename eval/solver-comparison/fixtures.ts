import type { ComparisonFixture } from "./grader.ts";

const records = [
	{
		id: "F11",
		url: "https://fleet.fixture.example/F11",
		value: "21.4",
		unit: " L",
	},
	{
		id: "F26",
		url: "https://fleet.fixture.example/F26",
		value: "8.7",
		unit: " L",
	},
	{
		id: "F43",
		url: "https://fleet.fixture.example/F43",
		value: "15.3",
		unit: " L",
	},
] as const;

/** These cases fix the user's acceptance policy before grading. */
export const comparisonCases = (
	[
		{ id: "all-known", expectedOutcome: "completed", missing: false },
		{ id: "unknown-allowed", expectedOutcome: "completed", missing: true },
		{
			id: "required-source-missing",
			expectedOutcome: "incomplete",
			missing: true,
		},
	] as const
).map(({ id, expectedOutcome, missing }) => {
	const rows: ComparisonFixture["rows"] = records.map((record, i) =>
		missing && i === 2
			? {
					id: record.id,
					url: record.url,
					kind: "unknown",
					limitation: `${record.id} の公式記録を取得できず、確定値は未確認。`,
				}
			: { ...record, kind: "known" },
	);
	const documents = rows.flatMap((row) =>
		row.kind === "known"
			? [
					{
						url: row.url,
						title: `車両 ${row.id} の補給記録`,
						text: `補給記録\n${row.id} = ${row.value}${row.unit}`,
						fetchedAt: 0,
						truncated: false,
					},
				]
			: [],
	);
	const instructions = [
		"車両の補給量を公式記録で照合し、Markdownに保存して読み戻してください。",
		"本文は対象ごとに1行だけ「対象ID = 値と単位 [公式記録](URL)」で記載し、主張も同じ対象ID・値・単位の文字列で作って、その対象の公式本文IDを1つ付けてください。",
		...rows.map((row) => `${row.id} ${row.url}`),
	];
	const unknown = rows.find((row) => row.kind === "unknown");
	if (unknown) {
		instructions.push(
			"取得できない対象は値を「不明」とし、主張もunknown、出典IDは空にしてください。",
			`その場合は本文の末尾とlimitationsに「${unknown.limitation}」を記載してください。`,
			expectedOutcome === "completed"
				? "不明を明記した報告でも、他の対象を確認できれば完了です。"
				: "全対象の公式本文による確定が完了の必須条件です。取得不能の場合は部分終了してください。",
		);
	}
	return {
		id,
		fixture: { expectedOutcome, rows },
		request: instructions.join("\n"),
		documents,
	};
});
