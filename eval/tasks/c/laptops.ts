import { formatYen } from "../../tools/text.ts";
import { type Candidate, defineComparisonTask, type Doc } from "./kit.ts";

type Row = {
	id: string;
	name: string;
	weight: number;
	ram: number;
	measured: number;
	claimed: number;
	price: number;
	msrp: number;
	saleNote?: string;
};

// Constraints: weight <= 1.30 kg, RAM >= 16 GB, measured battery >= 12 h,
// current price <= 170,000 yen. Valid: L01, L05, L13, L19.
const rows: Row[] = [
	{
		id: "L01",
		name: "Aster A13",
		weight: 1.24,
		ram: 16,
		measured: 13.5,
		claimed: 20,
		price: 164000,
		msrp: 189000,
	},
	{
		id: "L02",
		name: "Aster A14",
		weight: 1.45,
		ram: 16,
		measured: 14.0,
		claimed: 22,
		price: 158000,
		msrp: 179000,
	},
	{
		id: "L03",
		name: "Borea B2",
		weight: 1.19,
		ram: 8,
		measured: 12.8,
		claimed: 18,
		price: 139000,
		msrp: 149000,
	},
	{
		id: "L04",
		name: "Borea B3",
		weight: 1.21,
		ram: 16,
		measured: 9.7,
		claimed: 19,
		price: 168000,
		msrp: 189000,
	},
	{
		id: "L05",
		name: "Cygnus C1",
		weight: 1.3,
		ram: 16,
		measured: 12.0,
		claimed: 15,
		price: 169800,
		msrp: 199000,
	},
	{
		id: "L06",
		name: "Cygnus C2",
		weight: 1.32,
		ram: 32,
		measured: 15.1,
		claimed: 21,
		price: 198000,
		msrp: 220000,
	},
	{
		id: "L07",
		name: "Delta D5",
		weight: 1.1,
		ram: 16,
		measured: 12.4,
		claimed: 17,
		price: 172000,
		msrp: 174000,
	},
	{
		id: "L08",
		name: "Delta D7",
		weight: 1.28,
		ram: 16,
		measured: 11.9,
		claimed: 16,
		price: 149000,
		msrp: 159000,
	},
	{
		id: "L09",
		name: "Eos E1",
		weight: 1.5,
		ram: 16,
		measured: 16.0,
		claimed: 24,
		price: 139000,
		msrp: 159000,
	},
	{
		id: "L10",
		name: "Eos E2",
		weight: 1.15,
		ram: 12,
		measured: 12.5,
		claimed: 18,
		price: 152000,
		msrp: 162000,
	},
	{
		id: "L11",
		name: "Flux F1",
		weight: 1.35,
		ram: 16,
		measured: 12.2,
		claimed: 18,
		price: 129000,
		msrp: 139000,
	},
	{
		id: "L12",
		name: "Flux F3",
		weight: 1.22,
		ram: 16,
		measured: 13.0,
		claimed: 18,
		price: 171000,
		msrp: 185000,
		saleNote: "セール価格 159,000円は 2026-09-30 で終了",
	},
	{
		id: "L13",
		name: "Geo G1",
		weight: 1.26,
		ram: 16,
		measured: 12.7,
		claimed: 14,
		price: 166000,
		msrp: 172000,
	},
	{
		id: "L14",
		name: "Geo G2",
		weight: 1.4,
		ram: 32,
		measured: 18.0,
		claimed: 25,
		price: 230000,
		msrp: 250000,
	},
	{
		id: "L15",
		name: "Hana H1",
		weight: 1.05,
		ram: 8,
		measured: 10.5,
		claimed: 13,
		price: 119000,
		msrp: 129000,
	},
	{
		id: "L16",
		name: "Hana H2",
		weight: 1.29,
		ram: 16,
		measured: 10.9,
		claimed: 15,
		price: 161000,
		msrp: 169000,
	},
	{
		id: "L17",
		name: "Iris I1",
		weight: 1.31,
		ram: 16,
		measured: 14.2,
		claimed: 20,
		price: 155000,
		msrp: 165000,
	},
	{
		id: "L18",
		name: "Iris I3",
		weight: 1.25,
		ram: 16,
		measured: 13.3,
		claimed: 19,
		price: 189000,
		msrp: 199000,
	},
	{
		id: "L19",
		name: "Juno J1",
		weight: 1.18,
		ram: 24,
		measured: 12.1,
		claimed: 16,
		price: 168500,
		msrp: 170000,
	},
	{
		id: "L20",
		name: "Juno J2",
		weight: 1.18,
		ram: 16,
		measured: 12.3,
		claimed: 16,
		price: 170100,
		msrp: 180000,
	},
];

const candidates: Candidate[] = rows.map((r) => ({
	id: r.id,
	name: r.name,
	summary: { category: "14インチ ノートPC", msrp_jpy: r.msrp },
}));

function docsFor(r: Row): Doc[] {
	const spec = [
		`【仕様書】${r.name}`,
		`本体質量: ${r.weight.toFixed(2)} kg`,
		`メモリ: ${r.ram} GB`,
		`バッテリー駆動時間（メーカー公称）: 最大 ${r.claimed} 時間`,
		`メーカー希望小売価格: ${formatYen(r.msrp)}円（税込）`,
	].join("\n");
	const verdict =
		r.measured >= r.claimed
			? "公称値を上回った"
			: `公称の ${r.claimed} 時間には届かなかった`;
	const review = [
		`【レビュー】${r.name}`,
		`編集部の計測（動画のループ再生、輝度 150 nit、無線LAN接続）でのバッテリー駆動時間は ${r.measured.toFixed(1)} 時間で、${verdict}。`,
		"その他の使用感は概ね良好。",
	].join("\n");
	const price = [
		`【販売価格】${r.name}`,
		`2026-10-19 時点の販売価格: ${formatYen(r.price)}円（税込）`,
		...(r.saleNote === undefined ? [] : [`※ ${r.saleNote}。`]),
		"在庫: あり",
	].join("\n");
	return [
		{
			id: `spec-${r.id}`,
			candidateId: r.id,
			kind: "spec_sheet",
			title: `${r.name} 仕様書`,
			text: spec,
			facts: ["weight_kg", "ram_gb"],
		},
		{
			id: `review-${r.id}`,
			candidateId: r.id,
			kind: "review",
			title: `${r.name} レビュー（実測）`,
			text: review,
			facts: ["battery_measured_h"],
		},
		{
			id: `price-${r.id}`,
			candidateId: r.id,
			kind: "price_list",
			title: `${r.name} 販売価格`,
			text: price,
			facts: ["price_jpy"],
		},
	];
}

export const laptopSelection = defineComparisonTask({
	id: "c-laptop-selection",
	title: "条件を満たすノートPCの選定",
	goal: "出張用のノートPCを 1 台選んでください。条件は、本体質量 1.30 kg 以下、メモリ 16 GB 以上、編集部の実測のバッテリー駆動時間が 12 時間以上（メーカー公称値は条件に使わない）、2026-10-19 時点の販売価格が 170,000 円以下（税込）、の全部です。選んだ候補の id と、条件を満たすことの根拠にした文書の id を answer.json に提出してください。",
	traps: [
		"メーカー公称のバッテリー時間は大きいが実測は条件未満の候補（L04, L16）",
		"1.31 kg・11.9 時間・172,000 円・170,100 円・171,000 円など境界のすぐ外の候補",
		"希望小売価格と現在の販売価格が異なり、セール終了済みの記載がある候補（L12）",
		"仕様書だけでは実測バッテリーと現在価格が分からない",
	],
	candidates,
	docs: rows.flatMap(docsFor),
	valid: ["L01", "L05", "L13", "L19"],
	required: ["weight_kg", "ram_gb", "battery_measured_h", "price_jpy"],
	acceptanceText: {
		choice:
			"answer.json の choice が、重量・メモリ・実測バッテリー・販売価格の 4 条件をすべて満たす候補の id であること。",
		exist:
			"answer.json の sources が 1 件以上の文書 id で、すべて実在すること。",
		support:
			"sources のうち選んだ候補の文書が、4 条件それぞれ（質量・メモリ・実測バッテリー・現在の販売価格）を述べる記載をすべて含んでいること。",
	},
});
