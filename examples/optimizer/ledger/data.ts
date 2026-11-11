import type { Profile, Workload } from "../../../eval/optimizer/data.ts";

type Position = { user: string; time: number };
type Mutation =
	| ({ op: "P"; id: string; amount: number } & Position)
	| ({ op: "M"; id: string } & Position)
	| { op: "D"; id: string }
	| { op: "A"; id: string; delta: number };
type Query = { op: "Q"; user: string; end: number; width: number };
type Bulk = Omit<Query, "op"> & { op: "B"; delta: number };
type Order = Mutation | Query | Bulk | { op: "S" | "R"; name: string };
type Entry = Position & { amount: number };

function replacement(
	order: Mutation,
	old: Entry | undefined,
): Entry | undefined {
	if (order.op === "P") return order;
	if (!old || order.op === "D") return undefined;
	if (order.op === "M") return { ...order, amount: old.amount };
	return { ...old, amount: old.amount + order.delta };
}

function scan(orders: readonly Order[]): string {
	let entries = new Map<string, Entry>();
	const snapshots = new Map<string, Map<string, Entry>>();
	const output = [];
	for (const order of orders) {
		if (order.op === "S") {
			snapshots.set(order.name, new Map(entries));
		} else if (order.op === "R") {
			const saved = snapshots.get(order.name);
			if (saved) entries = new Map(saved);
		} else if (order.op === "B") {
			for (const [id, entry] of entries)
				if (
					entry.user === order.user &&
					entry.time > order.end - order.width &&
					entry.time <= order.end
				)
					entries.set(id, { ...entry, amount: entry.amount + order.delta });
		} else if (order.op === "Q") {
			let count = 0,
				sum = 0,
				latest = "-",
				time = -1;
			for (const [id, entry] of entries) {
				if (
					entry.user !== order.user ||
					entry.time <= order.end - order.width ||
					entry.time > order.end
				)
					continue;
				count++;
				sum += entry.amount;
				if (entry.time > time || (entry.time === time && id > latest)) {
					time = entry.time;
					latest = id;
				}
			}
			output.push(`${count} ${sum} ${latest}\n`);
		} else if ("id" in order) {
			const next = replacement(order, entries.get(order.id));
			if (next) entries.set(order.id, next);
			else entries.delete(order.id);
		}
	}
	return output.join("");
}

function indexed(orders: readonly Order[]): string {
	if (orders.some((order) => order.op === "B"))
		throw new Error("bulk ledger requires its range oracle");
	const index = indexOrders(orders);
	const entries = new Map<string, Entry>();
	const output: string[] = [];
	type Node = {
		updates: Node[];
		queries: { order: Query; output: number }[];
		change?: Mutation;
	};
	const root: Node = { updates: [], queries: [] };
	const snapshots = new Map<string, Node>();
	let active = root,
		nextOutput = 0;
	for (const order of orders) {
		if (order.op === "S") snapshots.set(order.name, active);
		else if (order.op === "R") active = snapshots.get(order.name) ?? active;
		else if (order.op === "Q")
			active.queries.push({ order, output: nextOutput++ });
		else if ("id" in order) {
			const next: Node = { updates: [], queries: [], change: order };
			active.updates.push(next);
			active = next;
		}
	}
	function assign(id: string, next: Entry | undefined) {
		const old = entries.get(id);
		if (old) index.update(id, old, -1);
		if (next) {
			entries.set(id, next);
			index.update(id, next, 1);
		} else entries.delete(id);
		return old;
	}
	type Step = { visit: Node } | { undo: string; previous: Entry | undefined };
	const stack: Step[] = [{ visit: root }];
	while (stack.length) {
		const step = stack.pop()!;
		if ("undo" in step) {
			assign(step.undo, step.previous);
			continue;
		}
		const { change, queries, updates } = step.visit;
		if (change) {
			const previous = assign(
				change.id,
				replacement(change, entries.get(change.id)),
			);
			stack.push({ undo: change.id, previous });
		}
		for (const { order, output: at } of queries)
			output[at] = index.query(order.user, order.end - order.width, order.end);
		for (let i = updates.length - 1; i >= 0; i--)
			stack.push({ visit: updates[i]! });
	}
	return output.join("");
}

function indexOrders(orders: readonly Order[]) {
	const positions = new Map<
		string,
		Map<string, { id: string; time: number }>
	>();
	const key = (id: string, time: number) => `${time}/${id}`;
	for (const order of orders) {
		if (order.op !== "P" && order.op !== "M") continue;
		const set = positions.get(order.user) ?? new Map();
		set.set(key(order.id, order.time), { id: order.id, time: order.time });
		positions.set(order.user, set);
	}
	const trees = new Map(
		[...positions].map(([user, set]) => {
			const points = [...set.values()].sort(
				(a, b) => a.time - b.time || (a.id < b.id ? -1 : 1),
			);
			return [
				user,
				{
					points,
					count: new Int32Array(points.length + 1),
					sum: new Float64Array(points.length + 1),
					ranks: new Map(
						points.map(({ id, time }, i) => [key(id, time), i + 1]),
					),
				},
			] as const;
		}),
	);
	return {
		update(id: string, entry: Entry, sign: 1 | -1) {
			const { count, sum, ranks } = trees.get(entry.user)!;
			for (
				let i = ranks.get(key(id, entry.time))!;
				i < count.length;
				i += i & -i
			) {
				count[i] = count[i]! + sign;
				sum[i] = sum[i]! + sign * entry.amount;
			}
		},
		query(user: string, start: number, end: number) {
			const tree = trees.get(user);
			if (!tree) return "0 0 -\n";
			const { points, count, sum } = tree;
			function prefix(t: number) {
				let left = 0,
					right = points.length;
				while (left < right) {
					const mid = (left + right) >>> 1;
					if (points[mid]!.time <= t) left = mid + 1;
					else right = mid;
				}
				let c = 0,
					s = 0;
				for (let i = left; i > 0; i -= i & -i) {
					c += count[i]!;
					s += sum[i]!;
				}
				return [c, s] as const;
			}
			const [upper, total] = prefix(end);
			const [lower, before] = prefix(start);
			if (upper === lower) return "0 0 -\n";
			let bit = 1 << (31 - Math.clz32(points.length)),
				rank = 0,
				remaining = upper;
			for (; bit; bit >>= 1) {
				const at = rank + bit;
				if (at < count.length && count[at]! < remaining) {
					remaining -= count[at]!;
					rank = at;
				}
			}
			return `${upper - lower} ${total - before} ${points[rank]!.id}\n`;
		},
	};
}

export function ordersFor(
	profile: Profile,
	size: number,
	seed: number,
): Order[] {
	let state = seed >>> 0;
	const next = (limit: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return (state >>> 5) % limit;
	};
	const users =
		profile === "concentrated" ? 2 : profile === "mixed" ? 23 : 1201;
	const pool = Math.max(1, Math.floor(size / 5));
	return Array.from({ length: size }, (_, i) => {
		const roll = next(100),
			id = `I${next(pool)}`,
			user = `U${next(users)}`;
		const time = i % 7 === 0 ? 3600 : next(86400),
			amount = next(2000000001) - 1000000000;
		if (roll < 32) return { op: "P", id, user, time, amount };
		if (roll < 48) return { op: "M", id, user, time };
		if (roll < 60) return { op: "A", id, delta: amount };
		if (roll < 70) return { op: "D", id };
		return {
			op: "Q",
			user,
			end: time,
			width: [0, 1, 3599, 3600, 86400][next(5)]!,
		};
	});
}

function encode(order: Order) {
	switch (order.op) {
		case "P":
			return `P ${order.id} ${order.user} ${order.time} ${order.amount}`;
		case "M":
			return `M ${order.id} ${order.user} ${order.time}`;
		case "A":
			return `A ${order.id} ${order.delta}`;
		case "D":
			return `D ${order.id}`;
		case "Q":
			return `Q ${order.user} ${order.end} ${order.width}`;
		case "B":
			return `B ${order.user} ${order.end} ${order.width} ${order.delta}`;
		case "S":
		case "R":
			return `${order.op} ${order.name}`;
	}
}

export function ledgerWorkload(
	id: string,
	orders: readonly Order[],
	useIndex = true,
): Workload {
	return {
		id,
		input: encodeOrders(orders),
		expected: useIndex ? indexed(orders) : scan(orders),
	};
}

export function ledgerChecks(seed: number): Workload[] {
	const p = (
		id: string,
		user: string,
		time: number,
		amount: number,
	): Order => ({ op: "P", id, user, time, amount });
	const q = (user: string, end = 3600, width = 3600): Order => ({
		op: "Q",
		user,
		end,
		width,
	});
	return [
		ledgerWorkload(
			"boundary-and-tie",
			[
				p("A", "u", 0, 8),
				p("a", "u", 1, -2),
				p("Z", "u", 3600, 4),
				p("b", "u", 3600, 0),
				q("u"),
				q("u", 3600, 0),
			],
			false,
		),
		ledgerWorkload(
			"replace-and-order",
			[
				p("z", "u", 20, 7),
				q("u"),
				p("z", "v", 1, -9),
				q("u"),
				q("v"),
				{ op: "D", id: "z" },
				q("v"),
				p("z", "u", 1, 0),
				q("u"),
			],
			false,
		),
		ledgerWorkload(
			"move-and-adjust",
			[
				p("z", "u", 20, -1),
				{ op: "A", id: "z", delta: -7 },
				{ op: "M", id: "z", user: "v", time: 2 },
				q("u"),
				q("v"),
				{ op: "D", id: "z" },
				{ op: "A", id: "z", delta: 1 },
				{ op: "M", id: "z", user: "u", time: 2 },
				q("v"),
				q("u"),
			],
			false,
		),
		...(["mixed", "concentrated", "distributed"] as const).map((profile) =>
			ledgerWorkload(
				`corrections-${profile}`,
				ordersFor(profile, 240, seed),
				false,
			),
		),
	];
}

export function snapshotOrders(
	profile: Profile,
	size: number,
	seed: number,
): Order[] {
	const prefix = Math.floor(size / 5);
	const users =
		profile === "concentrated" ? 2 : profile === "mixed" ? 23 : 1201;
	const warm: Order[] = Array.from({ length: prefix }, (_, i) => ({
		op: "P",
		id: `H${i}`,
		user: `U${i % users}`,
		time: i % 86400,
		amount: (i % 997) - 498,
	}));
	const tail = ordersFor(profile, size - prefix, seed).map(
		(order, i): Order => {
			const width =
				profile === "concentrated" ? 51 : Math.max(1, Math.floor(size / 29));
			if (i === 0) return { op: "S", name: "root" };
			if (i % 61 === 60) return { op: "R", name: "root" };
			if (i % 13 === 2) return { op: "S", name: `save${(i + seed) % width}` };
			if (i % 13 === 11)
				return { op: "R", name: `save${(Math.floor(i / 4) + seed) % width}` };
			return order;
		},
	);
	return [...warm, ...tail];
}

export function snapshotChecks(seed: number) {
	const branch: Order[] = [
		{ op: "P", id: "a", user: "x", time: 9, amount: 10 },
		{ op: "S", name: "root" },
		{ op: "A", id: "a", delta: -12 },
		{ op: "Q", user: "x", end: 10, width: 10 },
		{ op: "S", name: "left" },
		{ op: "R", name: "root" },
		{ op: "M", id: "a", user: "y", time: 10 },
		{ op: "P", id: "b", user: "y", time: 10, amount: -1 },
		{ op: "S", name: "right" },
		{ op: "Q", user: "y", end: 10, width: 10 },
		{ op: "R", name: "left" },
		{ op: "D", id: "a" },
		{ op: "S", name: "root" },
		{ op: "R", name: "missing" },
		{ op: "Q", user: "x", end: 10, width: 10 },
		{ op: "R", name: "right" },
		{ op: "Q", user: "y", end: 10, width: 10 },
		{ op: "R", name: "root" },
		{ op: "Q", user: "y", end: 10, width: 10 },
	];
	return [
		...ledgerChecks(seed),
		ledgerWorkload("independent-branches", branch, false),
		...(["mixed", "concentrated", "distributed"] as const).map((profile) =>
			ledgerWorkload(
				`snapshots-${profile}`,
				snapshotOrders(profile, 350, seed),
				false,
			),
		),
	];
}

export function encodeOrders(orders: readonly Order[]) {
	return `${orders.length}\n${orders.map(encode).join("\n")}\n`;
}

export function bulkOrders(
	profile: Profile,
	size: number,
	seed: number,
): Order[] {
	const population =
		profile === "concentrated" ? 2 : profile === "mixed" ? 23 : 1201;
	return snapshotOrders(profile, size, seed).map((order, i) => {
		if (
			i < Math.floor(size / 5) ||
			i % 6 !== 0 ||
			order.op === "S" ||
			order.op === "R"
		)
			return order;
		return {
			op: "B",
			user: `U${(Math.floor(i / 6) + seed) % population}`,
			end: i % 12 === 0 ? 86400 : i % 31000,
			width: i % 24 === 0 ? 86401 : 7200,
			delta: i % 12 === 0 ? -111111111 : 123456789,
		};
	});
}

export function bulkChecks(seed: number) {
	const keyCases: Order[] = [
		{ op: "P", id: "a", user: "u", time: 0, amount: 5 },
		{ op: "P", id: "b", user: "u", time: 9, amount: 10 },
		{ op: "S", name: "before" },
		{ op: "B", user: "u", end: 9, width: 9, delta: -7 },
		{ op: "Q", user: "u", end: 10, width: 11 },
		{ op: "M", id: "b", user: "v", time: 0 },
		{ op: "P", id: "c", user: "u", time: 9, amount: 1 },
		{ op: "Q", user: "u", end: 10, width: 11 },
		{ op: "S", name: "after" },
		{ op: "R", name: "before" },
		{ op: "Q", user: "u", end: 10, width: 11 },
		{ op: "Q", user: "v", end: 10, width: 11 },
		{ op: "R", name: "after" },
		{ op: "Q", user: "v", end: 10, width: 11 },
		{ op: "D", id: "c" },
		{ op: "B", user: "u", end: 9, width: 9, delta: 100 },
		{ op: "P", id: "c", user: "u", time: 9, amount: 2 },
		{ op: "Q", user: "u", end: 9, width: 9 },
	];
	return [
		...snapshotChecks(seed),
		ledgerWorkload("bulk-branch-and-lifecycle", keyCases, false),
		...(["mixed", "concentrated", "distributed"] as const).map((profile) =>
			ledgerWorkload(`bulk-${profile}`, bulkOrders(profile, 640, seed), false),
		),
	];
}
