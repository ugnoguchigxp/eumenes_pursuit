import type { Profile, Workload } from "../../../eval/optimizer/data.ts";

type Order =
	| readonly ["P", string, number, number, number]
	| readonly ["D", string]
	| readonly ["A", number, number]
	| readonly ["Q", number, number]
	| readonly ["S" | "R", string];

export function encode(vertices: number, orders: readonly Order[]) {
	return `${vertices} ${orders.length}\n${orders.map((order) => order.join(" ")).join("\n")}\n`;
}

function expected(orders: readonly Order[]) {
	let weights = new Map<number, number>();
	let edges = new Map<string, readonly [number, number, number]>();
	const saved = new Map<string, [typeof weights, typeof edges]>();
	const rows = [];
	for (const order of orders) {
		switch (order[0]) {
			case "P":
				edges.set(order[1], [order[2], order[3], order[4]]);
				break;
			case "D":
				edges.delete(order[1]);
				break;
			case "A":
				weights.set(order[1], (weights.get(order[1]) ?? 0) + order[2]);
				break;
			case "S":
				saved.set(order[1], [new Map(weights), new Map(edges)]);
				break;
			case "R": {
				const state = saved.get(order[1]);
				if (state) [weights, edges] = [new Map(state[0]), new Map(state[1])];
				break;
			}
			case "Q": {
				const [, u, v] = order;
				const queue = [u];
				const colours = new Map([[u, 0]]);
				let sum = 0,
					bad = false;
				for (const a of queue) {
					sum += weights.get(a) ?? 0;
					for (const [x, y, parity] of edges.values()) {
						const b = x === a ? y : y === a ? x : undefined;
						if (b === undefined) continue;
						const value = colours.get(a)! ^ parity;
						const old = colours.get(b);
						if (old === undefined) {
							colours.set(b, value);
							queue.push(b);
						} else bad ||= old !== value;
					}
				}
				const relation = !colours.has(v)
					? "unknown"
					: bad
						? "conflict"
						: colours.get(v)
							? "different"
							: "same";
				rows.push(`${relation} ${queue.length} ${sum}\n`);
			}
		}
	}
	return rows.join("");
}

export function networkData(
	profile: Profile,
	size: number,
	seed: number,
	versioned = false,
) {
	const vertices = Math.max(
		2,
		Math.floor(
			size / (profile === "concentrated" ? 20 : profile === "mixed" ? 5 : 2),
		),
	);
	let state = seed >>> 0;
	const next = (limit: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return (state >>> 5) % limit;
	};
	const prefix = Math.floor(size / 7);
	const orders: Order[] = Array.from({ length: size }, (_, i) => {
		if (i < prefix)
			return [
				"P",
				`chain${i}`,
				1 + (i % vertices),
				1 + ((i + 1) % vertices),
				i % 2,
			];
		const roll = next(100),
			id = `e${next(Math.max(1, Math.floor(size / 8)))}`,
			u = next(vertices) + 1,
			v = next(vertices) + 1;
		if (roll < 29) return ["P", id, u, v, next(2)];
		if (roll < 50) return ["D", id];
		if (roll < 66) return ["A", u, next(6251431) - 3125000];
		if (versioned && roll < 80) return [roll < 74 ? "S" : "R", `s${next(121)}`];
		return ["Q", u, v];
	});
	return { vertices, orders };
}

export function networkChecks(seed: number, versioned = false): Workload[] {
	const cases: { id: string; vertices: number; orders: Order[] }[] = [
		{
			id: "replace-and-delete",
			vertices: 3,
			orders: [
				["P", "a", 1, 2, 1],
				["Q", 1, 2],
				["P", "a", 1, 3, 0],
				["Q", 1, 2],
				["Q", 1, 3],
				["D", "a"],
				["D", "missing"],
				["Q", 1, 3],
			],
		},
		{
			id: "contradiction-recovery",
			vertices: 4,
			orders: [
				["P", "p", 1, 2, 1],
				["P", "q", 2, 3, 0],
				["P", "r", 1, 3, 0],
				["Q", 1, 3],
				["Q", 1, 4],
				["D", "r"],
				["Q", 1, 3],
				["P", "self", 3, 3, 1],
				["Q", 3, 3],
				["D", "self"],
				["Q", 3, 3],
			],
		},
		{
			id: "weights-follow-vertices",
			vertices: 3,
			orders: [
				["A", 1, 1000000000],
				["A", 1, 1000000000],
				["A", 2, -3],
				["P", "a", 1, 2, 0],
				["Q", 1, 2],
				["D", "a"],
				["Q", 1, 2],
				["Q", 2, 1],
				["P", "b", 2, 3, 1],
				["Q", 2, 3],
			],
		},
		...(["mixed", "concentrated", "distributed"] as const).map((profile) => ({
			id: profile,
			...networkData(profile, 370, seed, versioned),
		})),
	];
	if (versioned)
		cases.push({
			id: "restore-and-overwrite",
			vertices: 3,
			orders: [
				["R", "missing"],
				["S", "empty"],
				["P", "a", 1, 2, 1],
				["A", 2, 9],
				["S", "branch"],
				["P", "a", 1, 3, 0],
				["Q", 1, 2],
				["R", "empty"],
				["Q", 1, 3],
				["R", "branch"],
				["Q", 1, 2],
				["D", "a"],
				["S", "empty"],
				["R", "branch"],
				["Q", 1, 2],
				["R", "empty"],
				["Q", 2, 1],
			],
		});
	return cases.map(({ id, vertices, orders }) => ({
		id,
		input: encode(vertices, orders),
		expected: expected(orders),
	}));
}
