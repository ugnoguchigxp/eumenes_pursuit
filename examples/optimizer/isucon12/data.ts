export type Player = [tenant: string, id: string, name: string];
export type Score = [id: string, score: number];
export type Upload = [tenant: string, competition: string, rows: Score[]];
export type Request = [tenant: string, competition: string, rankAfter: number];
export interface Scenario {
	players: Player[];
	stages: { uploads: Upload[]; requests: Request[] }[];
}

export function workload(id: string, scenario: Scenario) {
	const boards = new Map<string, Score[]>();
	const expected: string[] = [];
	for (const { uploads, requests } of scenario.stages) {
		for (const [tenant, competition, scores] of uploads)
			boards.set(JSON.stringify([tenant, competition]), scores);
		for (const [tenant, competition, rankAfter] of requests) {
			const rows = boards.get(JSON.stringify([tenant, competition])) ?? [];
			const last = new Map(
				rows.map(([player, score], i) => [player, { score, i }]),
			);
			const names = new Map(
				scenario.players
					.filter(([owner]) => owner === tenant)
					.map(([, player, name]) => [player, name]),
			);
			expected.push(
				JSON.stringify(
					[...last.entries()]
						.sort(([, a], [, b]) => b.score - a.score || a.i - b.i)
						.slice(rankAfter, rankAfter + 100)
						.map(([player, { score }], i) => [
							rankAfter + i + 1,
							score,
							player,
							names.get(player),
						]),
				),
			);
		}
	}
	return {
		id,
		input: JSON.stringify(scenario),
		expected: `${expected.join("\n")}\n`,
	};
}

export const edgeCases: Scenario = {
	players: [
		["a", "p", "星"],
		["a", "q", "Q"],
		["a", "r", "R"],
		["b", "p", "Other tenant"],
	],
	stages: [
		{
			uploads: [
				[
					"a",
					"x",
					[
						["p", 99],
						["q", 7],
						["p", 7],
						["r", -4],
					],
				],
				["b", "x", [["p", 8]]],
			],
			requests: [
				["a", "x", 0],
				["a", "x", 1],
				["b", "x", 0],
				["a", "empty", 0],
				["a", "x", 99],
			],
		},
		{
			uploads: [["a", "x", [["p", 1]]]],
			requests: [
				["a", "x", 0],
				["b", "x", 0],
			],
		},
		{
			uploads: [["a", "x", []]],
			requests: [
				["a", "x", 0],
				["b", "x", 0],
			],
		},
	],
};

export function generated(
	seed: number,
	playersPerTenant: number,
	requests: number,
	batches: number,
): Scenario {
	let state = seed;
	const next = () =>
		(state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8;
	const tenants = ["north", "south"];
	const competitions = ["weekly", "final"];
	const players: Player[] = tenants.flatMap((tenant) =>
		Array.from({ length: playersPerTenant }, (_, i): Player => [
			tenant,
			`p${i}`,
			`${tenant}-${next()}-${i}`,
		]),
	);
	const upload = (
		tenant: string,
		competition: string,
		entries: number,
	): Upload => [
		tenant,
		competition,
		Array.from({ length: entries }, (): Score => [
			`p${next() % playersPerTenant}`,
			(next() % 31) - 5,
		]),
	];
	return {
		players,
		stages: Array.from({ length: batches }, (_, batch) => ({
			uploads:
				batch === 0
					? tenants.flatMap((tenant) =>
							competitions.map((competition) =>
								upload(tenant, competition, playersPerTenant * 4),
							),
						)
					: [upload("north", "weekly", playersPerTenant * (batch % 2 ? 2 : 3))],
			requests: Array.from({ length: requests }, (_, i): Request => [
				i % 4 === 1 ? "south" : "north",
				i % 4 === 2 ? "final" : "weekly",
				i < 3 ? i * 100 : next() % (playersPerTenant + 100),
			]),
		})),
	};
}
