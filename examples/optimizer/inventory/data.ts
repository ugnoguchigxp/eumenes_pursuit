import type { Profile, Workload } from "../../../eval/optimizer/data.ts";

type Edge = readonly [number, number, number];
type Order =
	| readonly ["U", number, number, number]
	| readonly ["Q", number, number, number, number]
	| readonly ["S" | "R", string];

export function encodeInventory(
	edges: readonly Edge[],
	orders: readonly Order[],
) {
	return `${edges.length + 1} ${orders.length}\n${[...edges, ...orders]
		.map((row) => row.join(" "))
		.join("\n")}\n`;
}

function expected(edges: readonly Edge[], orders: readonly Order[]) {
	const graph = Array.from(
		{ length: edges.length + 2 },
		() => [] as [number, number][],
	);
	for (const [u, v, d] of edges) {
		graph[u]!.push([v, d]);
		graph[v]!.push([u, d]);
	}
	let stock = new Map<number, number>();
	const saved = new Map<string, typeof stock>();
	const result = [];
	for (const order of orders) {
		switch (order[0]) {
			case "U":
				stock.set(order[1] * 8 + order[2], order[3]);
				break;
			case "S":
				saved.set(order[1], new Map(stock));
				break;
			case "R": {
				const state = saved.get(order[1]);
				if (state) stock = new Map(state);
				break;
			}
			case "Q": {
				const [, site, item, lo, hi] = order;
				const visit: [number, number, number][] = [[site, 0, 0]];
				let count = 0;
				let total = 0;
				for (const [u, parent, distance] of visit) {
					const quantity = stock.get(u * 8 + item) ?? 0;
					if (quantity && distance >= lo) {
						count++;
						total += quantity;
					}
					for (const [v, weight] of graph[u]!)
						if (v !== parent && distance + weight <= hi)
							visit.push([v, u, distance + weight]);
				}
				result.push(`${count} ${total}\n`);
				break;
			}
		}
	}
	return result.join("");
}

export function inventoryData(profile: Profile, size: number, seed: number) {
	const vertices = Math.max(1, Math.floor((size * 6) / 25));
	let state = seed >>> 0;
	const next = (limit: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return (state >>> 5) % limit;
	};
	const edges: Edge[] = Array.from({ length: vertices - 1 }, (_, i) => {
		const v = i + 2;
		const u =
			profile === "distributed"
				? v - 1
				: profile === "concentrated"
					? 1 + next(Math.min(12, v - 1))
					: Math.floor(v / 2);
		return [u, v, 1 + next(97)];
	});
	const prefix = Math.floor(size / 4);
	const orders: Order[] = Array.from({ length: size }, (_, i) => {
		const site = next(vertices) + 1;
		const item = next(8) + 1;
		if (i < prefix) return ["U", site, item, next(1000000001)];
		const roll = next(100);
		if (roll < 31) return ["U", site, item, next(4) ? next(1000000001) : 0];
		if (roll < 42) return ["S", `s${next(113)}`];
		if (roll < 53) return ["R", `s${next(113)}`];
		if (roll < 70) return ["Q", site, item, 0, 100000000000000];
		const span = profile === "distributed" ? vertices * 35 : 600;
		const lo = next(Math.max(1, span));
		return ["Q", site, item, lo, lo + next(Math.max(1, span))];
	});
	return { edges, orders };
}

export function inventoryChecks(seed: number): Workload[] {
	const cases: { id: string; edges: Edge[]; orders: Order[] }[] = [
		{
			id: "replace-and-restore",
			edges: [
				[1, 2, 4],
				[2, 3, 7],
				[2, 4, 3],
			],
			orders: [
				["R", "missing"],
				["U", 2, 2, 8],
				["U", 1, 1, 9],
				["U", 3, 1, 6],
				["S", "first"],
				["Q", 2, 1, 4, 7],
				["Q", 2, 1, 0, 3],
				["U", 3, 1, 0],
				["S", "second"],
				["R", "first"],
				["Q", 3, 1, 0, 0],
				["U", 4, 1, 13],
				["S", "first"],
				["R", "second"],
				["Q", 2, 1, 3, 7],
				["R", "first"],
				["Q", 2, 1, 3, 7],
			],
		},
		{
			id: "weighted-boundaries",
			edges: [
				[1, 2, 1000000000],
				[2, 3, 1000000000],
				[3, 4, 1000000000],
			],
			orders: [
				["U", 1, 8, 1000000000],
				["U", 2, 8, 1000000000],
				["U", 3, 8, 1000000000],
				["U", 4, 8, 1000000000],
				["Q", 1, 8, 0, 3000000000],
				["Q", 1, 8, 1000000001, 2999999999],
				["Q", 1, 8, 3000000000, 3000000000],
			],
		},
		{
			id: "single-site",
			edges: [],
			orders: [
				["Q", 1, 1, 0, 0],
				["U", 1, 1, 5],
				["Q", 1, 1, 0, 0],
			],
		},
		...(["mixed", "concentrated", "distributed"] as const).map((profile) => ({
			id: profile,
			...inventoryData(profile, 390, seed),
		})),
	];
	return cases.map(({ id, edges, orders }) => ({
		id,
		input: encodeInventory(edges, orders),
		expected: expected(edges, orders),
	}));
}
