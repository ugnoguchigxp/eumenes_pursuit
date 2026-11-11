export type Event = readonly [time: number, user: string, amount: number];
export interface Workload {
	readonly id: string;
	readonly input: string;
	readonly expected: string;
}
export const profiles = ["mixed", "concentrated", "distributed"] as const;
export type Profile = (typeof profiles)[number];

export function bruteForce(events: readonly Event[]): number[] {
	return events.map(([t, user]) =>
		events.reduce(
			(sum, [other, owner, amount]) =>
				owner === user && t - 3600 < other && other <= t ? sum + amount : sum,
			0,
		),
	);
}

export function reference(events: readonly Event[]): number[] {
	const groups = new Map<string, Event[]>();
	for (const event of events) {
		const group = groups.get(event[1]);
		if (group) group.push(event);
		else groups.set(event[1], [event]);
	}
	const indexes = new Map<string, { times: number[]; sums: number[] }>();
	for (const [user, group] of groups) {
		group.sort((a, b) => a[0] - b[0]);
		const sums = [0];
		for (const [, , amount] of group) sums.push(sums.at(-1)! + amount);
		indexes.set(user, { times: group.map(([time]) => time), sums });
	}
	function upperBound(times: readonly number[], time: number): number {
		let lo = 0;
		let hi = times.length;
		while (lo < hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (times[mid]! <= time) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}
	return events.map(([time, user]) => {
		const { times, sums } = indexes.get(user)!;
		return (
			sums[upperBound(times, time)]! - sums[upperBound(times, time - 3600)]!
		);
	});
}

export function eventsFor(
	profile: Profile,
	size: number,
	seed: number,
): Event[] {
	let state = seed >>> 0;
	const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
	const users =
		profile === "concentrated"
			? 3
			: profile === "mixed"
				? 100
				: Math.max(1, Math.floor(size / 2));
	return Array.from({ length: size }, (_, i) => {
		const time = i % 11 === 0 ? 3600 : (next() >>> 8) % 86400;
		const owner = (next() >>> 8) % users;
		return [time, `u${owner}`, ((next() >>> 4) % 2000001) - 1000000];
	});
}

export function workload(
	id: string,
	events: readonly Event[],
	oracle = reference,
): Workload {
	return {
		id,
		input: `${events.length}\n${events.map((event) => event.join(" ")).join("\n")}\n`,
		expected: oracle(events)
			.map((sum) => `${sum}\n`)
			.join(""),
	};
}

export function correctnessSuite(seed: number): Workload[] {
	const cases: Event[][] = [
		[[0, "a", -10]],
		[
			[3600, "a", 5],
			[0, "a", 8],
			[1, "a", -2],
			[3600, "b", 9],
			[3600, "a", -3],
		],
		[
			[9000, "a", -3],
			[9000, "a", 6],
			[9000, "b", 8],
			[9000, "a", 2],
		],
		...profiles.map((profile) => eventsFor(profile, 127, seed)),
	];
	return cases.map((events, i) =>
		workload(`correctness-${i + 1}`, events, bruteForce),
	);
}
