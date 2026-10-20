import { readAnswer, submitAnswerTool } from "../../tools/answer.ts";
import { pick, seededRandom } from "../rng.ts";
import { defineTool, fail, ok, prop } from "../../tools/tool-port.ts";
import { criterion, defineTask } from "../kit.ts";

export type Incident = {
	id: string;
	opened_at: string;
	severity: "sev1" | "sev2" | "sev3" | "sev4";
	service: string;
	title: string;
};

const PAGE_SIZE = 10;
const SERVICES = [
	"billing-api",
	"auth",
	"search",
	"notifier",
	"gateway",
	"batch",
];
const TITLES = [
	"レスポンス遅延",
	"5xx エラー率の上昇",
	"ジョブの滞留",
	"証明書の期限切れ警告",
	"キューの溢れ",
	"DB 接続の枯渇",
	"デプロイの失敗",
	"メモリ使用量の急増",
];
const SEVERITIES = [
	"sev1",
	"sev2",
	"sev2",
	"sev2",
	"sev3",
	"sev3",
	"sev3",
	"sev3",
	"sev3",
	"sev4",
	"sev4",
	"sev4",
] as const;

/** 64 incidents of 2026-09, newest first. Reproducible. */
export function buildSeptemberIncidents(): Incident[] {
	const random = seededRandom(20260930);
	const items: Incident[] = [];
	for (let i = 0; i < 64; i += 1) {
		const day = 1 + Math.floor((i * 30) / 64);
		const hour = Math.floor(random() * 24);
		const minute = Math.floor(random() * 60);
		const stamp = `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
		items.push({
			id: `INC-${String(2300 + i)}`,
			opened_at: stamp,
			severity: pick(random, SEVERITIES),
			service: pick(random, SERVICES),
			title: pick(random, TITLES),
		});
	}
	return items.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

export function buildAugustIncidents(): Incident[] {
	const random = seededRandom(20260831);
	const items: Incident[] = [];
	for (let i = 0; i < 31; i += 1) {
		const day = 1 + Math.floor((i * 31) / 31);
		items.push({
			id: `INC-${String(2200 + i)}`,
			opened_at: `2026-08-${String(day).padStart(2, "0")}T12:00`,
			severity: pick(random, SEVERITIES),
			service: pick(random, SERVICES),
			title: pick(random, TITLES),
		});
	}
	return items.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

function toCsv(items: Incident[]): string {
	const rows = items.map((i) =>
		[i.id, i.opened_at, i.severity, i.service, i.title].join(","),
	);
	return `id,opened_at,severity,service,title\n${rows.join("\n")}\n`;
}

const september = buildSeptemberIncidents();

export const paginatedTimeoutArchive = defineTask({
	id: "b-paginated-timeout-archive",
	group: "B",
	title: "ページ送りが 2 ページ目から失敗する月次件数の集計",
	goal: "障害管理システムで、2026 年 9 月に起票された重大度 sev1 のインシデントの件数を数え、answer.json に count（整数）として提出してください。",
	acceptance: [
		{
			id: "sev1-count",
			text: "answer.json の count が、2026 年 9 月に起票された sev1 インシデントの実際の件数と一致していること。",
			method: "machine",
		},
	],
	grant: ["data.read", "answer.write"],
	consultAnswer:
		"障害管理システムの不具合の原因は私にも分かりません。他の手段があればそれで進めてください。",
	expected: "completed",
	traps: [
		"list_incidents は 1 ページ目だけ成功し、2 ページ目以降は常に timeout になる",
		"1 ページ目の sev1 件数は全体より少ない（部分集計で答えると誤り）",
	],
	data: {
		"incidents-2026-09.json": september,
		"archive/incidents-2026-09.csv": toCsv(september),
		"archive/incidents-2026-08.csv": toCsv(buildAugustIncidents()),
	},
	hidden: {
		"expected.json": {
			count: september.filter((i) => i.severity === "sev1").length,
		},
	},
	build(env) {
		const tools = [
			defineTool(
				{
					name: "list_incidents",
					description:
						"インシデントを新しい順に 10 件ずつ返す。month は YYYY-MM、page は 1 始まり。",
					permission: "data.read",
					properties: {
						month: prop("string", "対象月 (YYYY-MM)"),
						page: prop("integer", "ページ番号（1 始まり）", { minimum: 1 }),
					},
					required: ["month", "page"],
					fingerprintFields: ["month", "page"],
				},
				async (input) => {
					if (input.month !== "2026-09")
						return fail(
							"not_found",
							`no incident data for ${String(input.month)}`,
						);
					const page = Number(input.page);
					const all = await env.data<Incident[]>("incidents-2026-09.json");
					const totalPages = Math.ceil(all.length / PAGE_SIZE);
					if (page > totalPages)
						return fail("no_such_page", `only ${totalPages} pages`);
					if (page >= 2)
						return fail(
							"timeout",
							"リクエストが 30 秒でタイムアウトしました。",
						);
					return ok({
						month: "2026-09",
						page,
						total_items: all.length,
						total_pages: totalPages,
						items: all.slice(0, PAGE_SIZE),
					});
				},
			),
			defineTool(
				{
					name: "list_archive_exports",
					description: "保管済みの月次エクスポート（CSV）の一覧を返す。",
					permission: "data.read",
					fingerprintFields: [],
				},
				async () => {
					const files = [];
					for (const file of [
						"incidents-2026-08.csv",
						"incidents-2026-09.csv",
					]) {
						const text = await Bun.file(
							`${env.dataDir}/archive/${file}`,
						).text();
						files.push({ file, rows: text.trim().split("\n").length - 1 });
					}
					return ok({ files });
				},
			),
			defineTool(
				{
					name: "read_archive_export",
					description:
						"月次エクスポート（CSV）を行単位で読む。1 回に最大 30 行。",
					permission: "data.read",
					properties: {
						file: prop("string", "list_archive_exports が返したファイル名"),
						from_row: prop("integer", "開始行（1 始まり、ヘッダを除く）", {
							minimum: 1,
						}),
						limit: prop("integer", "行数（最大 30）", {
							minimum: 1,
							maximum: 30,
						}),
					},
					required: ["file"],
					fingerprintFields: ["file", "from_row"],
				},
				async (input) => {
					const known = ["incidents-2026-08.csv", "incidents-2026-09.csv"];
					if (typeof input.file !== "string" || !known.includes(input.file)) {
						return fail("not_found", `no such export: ${String(input.file)}`);
					}
					const text = await Bun.file(
						`${env.dataDir}/archive/${input.file}`,
					).text();
					const [header, ...rows] = text.trim().split("\n");
					const from = typeof input.from_row === "number" ? input.from_row : 1;
					const limit = typeof input.limit === "number" ? input.limit : 30;
					const slice = rows.slice(from - 1, from - 1 + limit);
					const next = from - 1 + limit < rows.length ? from + limit : null;
					return ok(
						{
							file: input.file,
							header: header ?? "",
							total_rows: rows.length,
							from_row: from,
							rows: slice,
							next_from_row: next,
						},
						[{ kind: "source", uri: `archive://${input.file}` }],
					);
				},
			),
			submitAnswerTool({
				workDir: env.workDir,
				description: "回答を work/answer.json に書き込む（上書き）。",
				properties: {
					count: prop("integer", "sev1 インシデントの件数", { minimum: 0 }),
				},
				required: ["count"],
			}),
		];
		return {
			tools,
			async verify() {
				const answer = await readAnswer(env.workDir);
				if (answer.state !== "ok")
					return [
						criterion("sev1-count", false, `answer.json is ${answer.state}`),
					];
				const expected = await env.hidden<{ count: number }>("expected.json");
				return [
					criterion(
						"sev1-count",
						answer.value.count === expected.count,
						`expected ${expected.count}; answered ${String(answer.value.count)}`,
					),
				];
			},
		};
	},
});
