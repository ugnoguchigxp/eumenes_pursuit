import type { Profile, Workload } from "../../../eval/optimizer/data.ts";

type Range = readonly [number, number];
type Order =
	| readonly ["U", ...Range, number, number]
	| readonly ["Q", ...Range]
	| readonly ["S" | "R", string];
const modulus = 1_000_000_007n;

export function encodeMoments(n: number, orders: readonly Order[]) {
	return `${n} ${orders.length}\n${orders.map((row) => row.join(" ")).join("\n")}\n`;
}

function oracle(n: number, orders: readonly Order[]) {
	let values = Array<bigint>(n).fill(0n);
	const saved = new Map<string, bigint[]>();
	const rows = [];
	for (const row of orders) {
		switch (row[0]) {
			case "S":
				saved.set(row[1], [...values]);
				break;
			case "R": {
				const previous = saved.get(row[1]);
				if (previous) values = [...previous];
				break;
			}
			case "U":
				for (let i = row[1] - 1; i < row[2]; i++)
					values[i] = (values[i]! * BigInt(row[3]) + BigInt(row[4])) % modulus;
				break;
			case "Q": {
				let sum = 0n,
					squared = 0n,
					weighted = 0n;
				for (let i = row[1] - 1; i < row[2]; i++) {
					const x = values[i]!;
					sum += x;
					squared += x * x;
					weighted += BigInt(i + 1) * x;
				}
				rows.push(
					`${sum % modulus} ${squared % modulus} ${weighted % modulus}\n`,
				);
			}
		}
	}
	return rows.join("");
}

export function momentsData(
	profile: Profile,
	size: number,
	seed: number,
	n = 1_000_000_000,
) {
	let state = seed >>> 0;
	const next = (limit: number) => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) % limit;
	};
	const orders: Order[] = Array.from({ length: size }, (_, i) => {
		const roll = next(100);
		const name = `s${next(101)}`;
		if (roll < 9) return ["S", name];
		if (roll < 18) return ["R", name];
		const x = next(n) + 1;
		const y =
			profile === "concentrated" && i % 3 !== 0
				? Math.min(n, x + next(Math.max(1, Math.floor(n / 60))))
				: next(n) + 1;
		const range: Range =
			profile === "distributed" && i % 13 === 0
				? [1, n]
				: [Math.min(x, y), Math.max(x, y)];
		if (roll < 62)
			return [
				"U",
				...range,
				i % 11 === 0 ? 0 : next(1000000007),
				next(1000000007),
			];
		return ["Q", ...range];
	});
	return { n, orders };
}

export function momentsChecks(seed: number): Workload[] {
	const cases: { id: string; n: number; orders: Order[] }[] = [
		{
			id: "restore-overlap",
			n: 4,
			orders: [
				["R", "absent"],
				["Q", 1, 4],
				["U", 1, 4, 0, 2],
				["S", "a"],
				["U", 2, 3, 3, 1],
				["Q", 1, 4],
				["S", "b"],
				["R", "a"],
				["Q", 2, 3],
				["U", 1, 2, 0, 4],
				["S", "a"],
				["R", "b"],
				["Q", 2, 4],
				["R", "a"],
				["Q", 1, 4],
			],
		},
		{
			id: "composition-and-modulo",
			n: 3,
			orders: [
				["U", 1, 3, 0, 1000000006],
				["U", 1, 2, 2, 1],
				["U", 1, 1, 0, 0],
				["Q", 1, 3],
				["Q", 3, 3],
				["U", 1, 3, 1, 2],
				["Q", 1, 3],
			],
		},
		...(["mixed", "concentrated", "distributed"] as const).map((profile) => ({
			id: profile,
			...momentsData(profile, 440, seed, 81),
		})),
	];
	return cases.map(({ id, n, orders }) => ({
		id,
		input: encodeMoments(n, orders),
		expected: oracle(n, orders),
	}));
}
