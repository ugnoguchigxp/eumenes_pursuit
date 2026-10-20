import { type Candidate, defineComparisonTask, type Doc } from "./kit.ts";

type Row = {
	id: string;
	name: string;
	/** "Type II until YYYY-MM-DD" or free text for the weaker cases. */
	soc2: string;
	soc2Until: string | null;
	region: string;
	backup: string;
	tier1: number;
	tier2: number;
	sla: number;
};

// Constraints: SOC 2 Type II valid on 2026-10-20, primary and backup data in
// Japan, monthly cost at 10 TB <= 250,000 yen, SLA >= 99.95%.
// Cost = 5,000 GB * tier1 + 5,000 GB * tier2.
// Valid: W01, W07, W11, W15.
const rows: Row[] = [
	{
		id: "W01",
		name: "ログ蔵",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-03-31）",
		soc2Until: "2027-03-31",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 30,
		tier2: 20,
		sla: 99.95,
	},
	{
		id: "W02",
		name: "ハヤテログ",
		soc2: "SOC 2 Type II 報告書（有効期限 2026-08-31）。更新監査は未完了",
		soc2Until: "2026-08-31",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 25,
		tier2: 15,
		sla: 99.99,
	},
	{
		id: "W03",
		name: "オービットストア",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-06-30）",
		soc2Until: "2027-06-30",
		region: "日本（東京）",
		backup: "米国（オレゴン）",
		tier1: 28,
		tier2: 18,
		sla: 99.99,
	},
	{
		id: "W04",
		name: "ニンバスアーカイブ",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-01-15）",
		soc2Until: "2027-01-15",
		region: "日本（東京）",
		backup: "日本（東京・別拠点）",
		tier1: 35,
		tier2: 20,
		sla: 99.99,
	},
	{
		id: "W05",
		name: "カスミ",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-05-31）",
		soc2Until: "2027-05-31",
		region: "日本（大阪）",
		backup: "日本（東京）",
		tier1: 26,
		tier2: 18,
		sla: 99.9,
	},
	{
		id: "W06",
		name: "タイドストレージ",
		soc2: "SOC 2 Type I のみ取得。Type II は監査中",
		soc2Until: null,
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 20,
		tier2: 10,
		sla: 99.99,
	},
	{
		id: "W07",
		name: "クアンタ",
		soc2: "SOC 2 Type II 報告書（有効期限 2026-12-31）",
		soc2Until: "2026-12-31",
		region: "日本（東京）",
		backup: "日本（東京・別拠点）",
		tier1: 22,
		tier2: 22,
		sla: 99.95,
	},
	{
		id: "W08",
		name: "ペガサス",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-02-28）",
		soc2Until: "2027-02-28",
		region: "シンガポール",
		backup: "シンガポール",
		tier1: 15,
		tier2: 10,
		sla: 99.99,
	},
	{
		id: "W09",
		name: "ミカヅキ",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-09-30）",
		soc2Until: "2027-09-30",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 40,
		tier2: 15,
		sla: 99.99,
	},
	{
		id: "W10",
		name: "ストラタス",
		soc2: "SOC 2 Type II 報告書（有効期限 2026-10-19）",
		soc2Until: "2026-10-19",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 24,
		tier2: 16,
		sla: 99.99,
	},
	{
		id: "W11",
		name: "エンバー",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-04-30）",
		soc2Until: "2027-04-30",
		region: "日本（大阪）",
		backup: "日本（東京）",
		tier1: 25,
		tier2: 25,
		sla: 99.95,
	},
	{
		id: "W12",
		name: "フィヨルド",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-04-30）",
		soc2Until: "2027-04-30",
		region: "日本（東京）",
		backup: "アイルランド",
		tier1: 20,
		tier2: 12,
		sla: 99.99,
	},
	{
		id: "W13",
		name: "グレイシャー",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-12-31）",
		soc2Until: "2027-12-31",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 18,
		tier2: 12,
		sla: 99.9,
	},
	{
		id: "W14",
		name: "ヘリックス",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-03-31）",
		soc2Until: "2027-03-31",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 30,
		tier2: 21,
		sla: 99.99,
	},
	{
		id: "W15",
		name: "インディゴ",
		soc2: "SOC 2 Type II 報告書（有効期限 2027-03-31）",
		soc2Until: "2027-03-31",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 26,
		tier2: 22,
		sla: 99.95,
	},
	{
		id: "W16",
		name: "ジェイド",
		soc2: "SOC 2 Type II 報告書（有効期限 2026-11-30）",
		soc2Until: "2026-11-30",
		region: "日本（東京）",
		backup: "日本（大阪）",
		tier1: 30,
		tier2: 19,
		sla: 99.94,
	},
];

const candidates: Candidate[] = rows.map((r) => ({
	id: r.id,
	name: r.name,
	summary: {
		product: "ログ保管 SaaS",
		note: "認証・保管地域・料金・SLA は各文書を参照",
	},
}));

function cost(r: Row): number {
	return 5000 * r.tier1 + 5000 * r.tier2;
}

function docsFor(r: Row): Doc[] {
	const security = [
		`【セキュリティ概要】${r.name}`,
		`第三者認証: ${r.soc2}`,
		`データの保管地域（本番）: ${r.region}`,
		`データの保管地域（バックアップ）: ${r.backup}`,
	].join("\n");
	const pricing = [
		`【料金表】${r.name}`,
		"月額従量課金（円/GB、1 TB = 1,000 GB として計算）:",
		`  先頭 5 TB まで: ${r.tier1} 円/GB`,
		`  5 TB を超える分: ${r.tier2} 円/GB`,
		"最低利用料なし。",
	].join("\n");
	const sla = [
		`【SLA】${r.name}`,
		`月間稼働率の保証値: ${r.sla.toFixed(2)}%`,
		"未達の場合は翌月の利用料から割引する。",
	].join("\n");
	return [
		{
			id: `security-${r.id}`,
			candidateId: r.id,
			kind: "security",
			title: `${r.name} セキュリティ概要`,
			text: security,
			facts: ["soc2_type2_valid_until", "data_region"],
		},
		{
			id: `pricing-${r.id}`,
			candidateId: r.id,
			kind: "price_list",
			title: `${r.name} 料金表`,
			text: pricing,
			facts: ["monthly_cost_10tb"],
		},
		{
			id: `sla-${r.id}`,
			candidateId: r.id,
			kind: "sla",
			title: `${r.name} SLA`,
			text: sla,
			facts: ["sla_uptime"],
		},
	];
}

export const vendorSelection = defineComparisonTask({
	id: "c-vendor-selection",
	title: "ログ保管サービスの選定",
	goal: "社内ログの保管サービスを 1 社選んでください。条件は、2026-10-20 時点で有効な SOC 2 Type II 報告書があること、本番とバックアップのデータがどちらも日本国内にあること、10 TB（10,000 GB）保管時の月額が 250,000 円以下、月間稼働率の SLA が 99.95% 以上、の全部です。選んだサービスの id と、条件を満たすことの根拠にした文書の id を answer.json に提出してください。",
	traps: [
		"SOC 2 の期限が昨日・数か月前に切れている、または Type I しかない候補（W02, W06, W10）",
		"本番は日本でもバックアップが国外の候補（W03, W12）",
		"段階料金の合計が上限をわずかに超える候補（W04, W14）",
		"SLA が 99.94% など境界の外の候補（W16）",
	],
	candidates,
	docs: rows.flatMap(docsFor),
	valid: rows
		.filter(
			(r) =>
				r.soc2Until !== null &&
				r.soc2Until >= "2026-10-20" &&
				r.region.startsWith("日本") &&
				r.backup.startsWith("日本") &&
				cost(r) <= 250000 &&
				r.sla >= 99.95,
		)
		.map((r) => r.id),
	required: [
		"soc2_type2_valid_until",
		"data_region",
		"monthly_cost_10tb",
		"sla_uptime",
	],
	acceptanceText: {
		choice:
			"answer.json の choice が、SOC 2 Type II の有効性・保管地域・月額・SLA の 4 条件をすべて満たすサービスの id であること。",
		exist:
			"answer.json の sources が 1 件以上の文書 id で、すべて実在すること。",
		support:
			"sources のうち選んだサービスの文書が、4 条件それぞれ（認証の有効期限・保管地域・料金・SLA）を述べる記載をすべて含んでいること。",
	},
});
