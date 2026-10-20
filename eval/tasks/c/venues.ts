import { formatYen } from "../../tools/text.ts";
import { type Candidate, defineComparisonTask, type Doc } from "./kit.ts";

type Row = {
	id: string;
	name: string;
	school: number;
	theater: number;
	walk: number;
	/** Free-text lines about 2026-11-20 availability and other booked days. */
	booked: string;
	freeOn1120: boolean;
	base: number;
	equip: number;
};

// Constraints: school layout >= 40, walk <= 10 min, free all day 2026-11-20,
// total (base + mandatory equipment, +10% tax) <= 120,000. Valid: V01, V06, V08.
const rows: Row[] = [
	{
		id: "V01",
		name: "桜ホール",
		school: 48,
		theater: 80,
		walk: 5,
		booked: "11/03、11/21",
		freeOn1120: true,
		base: 85000,
		equip: 15000,
	},
	{
		id: "V02",
		name: "みなと会議室",
		school: 36,
		theater: 60,
		walk: 4,
		booked: "なし",
		freeOn1120: true,
		base: 70000,
		equip: 10000,
	},
	{
		id: "V03",
		name: "リバーサイドセンター",
		school: 42,
		theater: 70,
		walk: 12,
		booked: "なし",
		freeOn1120: true,
		base: 80000,
		equip: 8000,
	},
	{
		id: "V04",
		name: "北センタービル 5F",
		school: 40,
		theater: 64,
		walk: 8,
		booked: "11/20",
		freeOn1120: false,
		base: 60000,
		equip: 10000,
	},
	{
		id: "V05",
		name: "ひかりカンファレンス",
		school: 44,
		theater: 90,
		walk: 6,
		booked: "11/19、11/21",
		freeOn1120: true,
		base: 98000,
		equip: 12000,
	},
	{
		id: "V06",
		name: "あさひプラザ",
		school: 50,
		theater: 100,
		walk: 10,
		booked: "なし",
		freeOn1120: true,
		base: 90000,
		equip: 0,
	},
	{
		id: "V07",
		name: "つばさ貸会議室",
		school: 30,
		theater: 50,
		walk: 3,
		booked: "なし",
		freeOn1120: true,
		base: 50000,
		equip: 5000,
	},
	{
		id: "V08",
		name: "なごみ研修館",
		school: 40,
		theater: 55,
		walk: 9,
		booked: "11/10、11/27",
		freeOn1120: true,
		base: 100000,
		equip: 9000,
	},
	{
		id: "V09",
		name: "グランプラザ東京",
		school: 120,
		theater: 200,
		walk: 7,
		booked: "なし",
		freeOn1120: true,
		base: 180000,
		equip: 30000,
	},
	{
		id: "V10",
		name: "せいらんホール",
		school: 45,
		theater: 80,
		walk: 11,
		booked: "なし",
		freeOn1120: true,
		base: 70000,
		equip: 5000,
	},
	{
		id: "V11",
		name: "かえで会議室",
		school: 38,
		theater: 52,
		walk: 5,
		booked: "なし",
		freeOn1120: true,
		base: 60000,
		equip: 5000,
	},
	{
		id: "V12",
		name: "うみ貸しホール",
		school: 46,
		theater: 90,
		walk: 7,
		booked: "11/20 の 13:00〜17:00（午前のみ空き）",
		freeOn1120: false,
		base: 75000,
		equip: 10000,
	},
	{
		id: "V13",
		name: "ゆめ研修センター",
		school: 60,
		theater: 120,
		walk: 15,
		booked: "なし",
		freeOn1120: true,
		base: 65000,
		equip: 0,
	},
	{
		id: "V14",
		name: "とら会議室",
		school: 41,
		theater: 66,
		walk: 6,
		booked: "11/05",
		freeOn1120: true,
		base: 97000,
		equip: 14000,
	},
	{
		id: "V15",
		name: "そらホール",
		school: 48,
		theater: 90,
		walk: 9,
		booked: "なし",
		freeOn1120: true,
		base: 80000,
		equip: 40000,
	},
	{
		id: "V16",
		name: "みどり研修館",
		school: 40,
		theater: 70,
		walk: 20,
		booked: "なし",
		freeOn1120: true,
		base: 60000,
		equip: 0,
	},
	{
		id: "V17",
		name: "ロータス貸会議室",
		school: 39,
		theater: 60,
		walk: 2,
		booked: "なし",
		freeOn1120: true,
		base: 55000,
		equip: 5000,
	},
	{
		id: "V18",
		name: "かぜカンファレンス",
		school: 43,
		theater: 75,
		walk: 4,
		booked: "11/18、11/19",
		freeOn1120: true,
		base: 104000,
		equip: 6000,
	},
];

const candidates: Candidate[] = rows.map((r) => ({
	id: r.id,
	name: r.name,
	summary: { area: "都内", note: "料金・空き・収容人数は各文書を参照" },
}));

function total(r: Row): number {
	return Math.round((r.base + r.equip) * 1.1);
}

function docsFor(r: Row): Doc[] {
	const pamphlet = [
		`【会場案内】${r.name}`,
		`収容人数: シアター形式 ${r.theater} 名 / スクール形式（机あり） ${r.school} 名`,
		`アクセス: 最寄り駅から徒歩 ${r.walk} 分`,
		"設備: 無線LAN、プロジェクター、ホワイトボード",
	].join("\n");
	const calendar = [
		`【予約状況 2026年11月】${r.name}`,
		`予約済み: ${r.booked}`,
		"上記以外の日は終日空きがある。",
	].join("\n");
	const price = [
		`【料金表】${r.name}`,
		`1 日利用料（税抜）: ${formatYen(r.base)}円`,
		`必須付帯設備費（税抜）: ${formatYen(r.equip)}円`,
		"消費税 10% が合計に別途かかる。",
	].join("\n");
	return [
		{
			id: `pamphlet-${r.id}`,
			candidateId: r.id,
			kind: "pamphlet",
			title: `${r.name} 会場案内`,
			text: pamphlet,
			facts: ["school_capacity", "walk_minutes"],
		},
		{
			id: `calendar-${r.id}`,
			candidateId: r.id,
			kind: "calendar",
			title: `${r.name} 予約状況`,
			text: calendar,
			facts: ["available_1120"],
		},
		{
			id: `pricing-${r.id}`,
			candidateId: r.id,
			kind: "price_list",
			title: `${r.name} 料金表`,
			text: price,
			facts: ["total_cost"],
		},
	];
}

export const venueSelection = defineComparisonTask({
	id: "c-venue-selection",
	title: "研修会場の選定",
	goal: "2026-11-20 に 40 名の研修を行う会場を 1 つ選んでください。条件は、机を並べるスクール形式で 40 名以上入れること、最寄り駅から徒歩 10 分以内、2026-11-20 が終日空いていること、利用料の総額（1 日利用料に必須付帯設備費を足し、消費税 10% を加えた額）が 120,000 円以下、の全部です。選んだ会場の id と、条件を満たすことの根拠にした文書の id を answer.json に提出してください。",
	traps: [
		"シアター形式の収容人数は多いがスクール形式では 40 名に満たない会場（V02, V11）",
		"料金は 1 日利用料だけでなく必須付帯設備費と消費税を足すと上限を超える会場（V05, V14, V15, V18）",
		"2026-11-20 の午後だけ予約済みの会場（V12）",
		"徒歩 11 分など境界のすぐ外の会場（V10）",
	],
	candidates,
	docs: rows.flatMap(docsFor),
	valid: rows
		.filter(
			(r) =>
				r.school >= 40 && r.walk <= 10 && r.freeOn1120 && total(r) <= 120000,
		)
		.map((r) => r.id),
	required: ["school_capacity", "walk_minutes", "available_1120", "total_cost"],
	acceptanceText: {
		choice:
			"answer.json の choice が、スクール形式の収容人数・徒歩時間・11/20 の空き・総額の 4 条件をすべて満たす会場の id であること。",
		exist:
			"answer.json の sources が 1 件以上の文書 id で、すべて実在すること。",
		support:
			"sources のうち選んだ会場の文書が、4 条件それぞれ（スクール形式の収容人数・徒歩時間・11/20 の空き・料金）を述べる記載をすべて含んでいること。",
	},
});
