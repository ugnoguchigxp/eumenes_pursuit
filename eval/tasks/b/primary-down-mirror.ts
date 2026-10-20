import { readAnswer, submitAnswerTool } from "../../tools/answer.ts";
import { defineTool, fail, ok, prop } from "../../tools/tool-port.ts";
import { criterion, defineTask } from "../kit.ts";

type RateDay = { date: string; open: number; close: number };

const days: RateDay[] = [
	{ date: "2026-09-25", open: 148.4, close: 148.62 },
	{ date: "2026-09-28", open: 148.6, close: 148.05 },
	{ date: "2026-09-29", open: 148.02, close: 147.81 },
	{ date: "2026-09-30", open: 147.83, close: 147.32 },
	{ date: "2026-10-01", open: 147.35, close: 147.6 },
	{ date: "2026-10-02", open: 147.58, close: 148.1 },
];

export const primaryDownMirror = defineTask({
	id: "b-primary-down-mirror",
	group: "B",
	title: "為替レート API が落ちている日の終値",
	goal: "2026-09-30 の USD/JPY の終値レートを調べ、answer.json に rate（円、小数）として提出してください。",
	acceptance: [
		{
			id: "rate-value",
			text: "answer.json の rate が、2026-09-30 の USD/JPY 公式終値と小数第 2 位まで一致していること。",
			method: "machine",
		},
	],
	grant: ["data.read", "answer.write"],
	consultAnswer:
		"その API の復旧時期は私にも分かりません。他に使える手段があれば、それで進めてください。",
	expected: "completed",
	traps: [
		"fetch_primary_rate は常に upstream_unavailable を返す",
		"fetch_cached_rate は古い値（2026-09-28 の終値）を stale 付きで返す",
	],
	data: { "mirror_rates.json": days },
	hidden: { "expected.json": { rate: 147.32 } },
	build(env) {
		const pairProp = prop("string", "通貨ペア", { enum: ["USDJPY"] });
		const tools = [
			defineTool(
				{
					name: "fetch_primary_rate",
					description: "為替レートサービス本体から、指定日の終値を取得する。",
					permission: "data.read",
					properties: {
						pair: pairProp,
						date: prop("string", "日付 (YYYY-MM-DD)"),
					},
					required: ["pair", "date"],
					fingerprintFields: ["pair", "date"],
				},
				async () =>
					fail("upstream_unavailable", "レートサービス本体に接続できません。"),
			),
			defineTool(
				{
					name: "fetch_mirror_rate",
					description:
						"社内ミラーから終値を取得する。ミラーは本体の日次データを翌営業日に複製した読み取り専用の写しで、複製済みの日付だけ引ける。",
					permission: "data.read",
					properties: {
						pair: pairProp,
						date: prop("string", "日付 (YYYY-MM-DD)"),
					},
					required: ["pair", "date"],
					fingerprintFields: ["pair", "date"],
				},
				async (input) => {
					const all = await env.data<RateDay[]>("mirror_rates.json");
					const day = all.find((d) => d.date === input.date);
					if (day === undefined)
						return fail(
							"not_found",
							`mirror has no data for ${String(input.date)}`,
						);
					return ok(
						{
							pair: String(input.pair),
							date: day.date,
							open: day.open,
							close: day.close,
							source: "mirror",
						},
						[{ kind: "source", uri: `mirror://rates/${day.date}` }],
					);
				},
			),
			defineTool(
				{
					name: "fetch_cached_rate",
					description:
						"直近に取得できたレートのキャッシュを返す（日付指定なし）。",
					permission: "data.read",
					properties: { pair: pairProp },
					required: ["pair"],
					fingerprintFields: ["pair"],
				},
				async (input) => {
					const all = await env.data<RateDay[]>("mirror_rates.json");
					const day = all.find((d) => d.date === "2026-09-28");
					if (day === undefined) throw new Error("fixture: cache day missing");
					return ok({
						pair: String(input.pair),
						as_of: day.date,
						close: day.close,
						stale: true,
						note: "キャッシュは更新が止まっている。as_of の日付の値。",
					});
				},
			),
			submitAnswerTool({
				workDir: env.workDir,
				description: "回答を work/answer.json に書き込む（上書き）。",
				properties: { rate: prop("number", "終値（円）") },
				required: ["rate"],
			}),
		];
		return {
			tools,
			async verify() {
				const answer = await readAnswer(env.workDir);
				if (answer.state !== "ok")
					return [
						criterion("rate-value", false, `answer.json is ${answer.state}`),
					];
				const expected = await env.hidden<{ rate: number }>("expected.json");
				const value = answer.value.rate;
				const passed =
					typeof value === "number" && Math.abs(value - expected.rate) < 0.005;
				return [
					criterion(
						"rate-value",
						passed,
						`expected ${expected.rate}; answered ${String(value)}`,
					),
				];
			},
		};
	},
});
