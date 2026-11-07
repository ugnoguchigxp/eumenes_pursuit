/** Evaluation environments only. These simulations have observable outcomes, no known optimum. */
export type StudyKind = "cache" | "scheduler";
export type Weights = {
	age: number;
	frequency: number;
	cost: number;
	fairness: number;
};
export function simulate(
	kind: StudyKind,
	weights: Weights,
	seed: number,
	size = 3000,
) {
	let state = seed >>> 0;
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
	let cost = 0,
		served = 0,
		missed = 0;
	const groups = [0, 0, 0, 0];
	if (kind === "cache") {
		const cache = new Map<
			number,
			{ touched: number; hits: number; cost: number; group: number }
		>();
		for (let i = 0; i < size; i++) {
			const group = Math.floor(random() * 4);
			const phase = Math.floor(i / 500) % 3;
			const key = group * 100 + Math.floor(random() ** (1 + phase) * 90);
			const expense = 1 + (key % 17);
			const hit = cache.get(key);
			if (hit) {
				hit.hits++;
				hit.touched = i;
				served++;
				groups[group] = groups[group]! + 1;
			} else {
				cost += expense;
				missed++;
				if (cache.size >= 40) {
					let victim = -1,
						lowest = Infinity;
					for (const [id, entry] of cache) {
						const score =
							(-weights.age * (i - entry.touched)) / 100 +
							weights.frequency * Math.log1p(entry.hits) +
							(weights.cost * entry.cost) / 17 -
							(weights.fairness * groups[entry.group]!) / (i + 1);
						if (score < lowest) {
							lowest = score;
							victim = id;
						}
					}
					cache.delete(victim);
				}
				cache.set(key, { touched: i, hits: 1, cost: expense, group });
			}
		}
	} else {
		const pending: {
			group: number;
			born: number;
			work: number;
			deadline: number;
		}[] = [];
		for (let tick = 0; tick < size; tick++) {
			const arrivals = Math.floor(random() * 4);
			for (let n = 0; n < arrivals; n++) {
				const group = Math.floor(random() * 4),
					work = 1 + Math.floor(random() * 8);
				pending.push({
					group,
					born: tick,
					work,
					deadline: tick + 4 + Math.floor(random() * 24),
				});
			}
			for (let slot = 0; slot < 2 && pending.length; slot++) {
				let chosen = 0,
					highest = -Infinity;
				for (const [j, job] of pending.entries()) {
					const score =
						weights.age * (tick - job.born) +
						weights.frequency / Math.max(1, job.deadline - tick) -
						weights.cost * job.work -
						(weights.fairness * groups[job.group]!) / (tick + 1);
					if (score > highest) {
						highest = score;
						chosen = j;
					}
				}
				const job = pending[chosen]!;
				job.work--;
				if (job.work === 0) {
					pending.splice(chosen, 1);
					served++;
					groups[job.group] = groups[job.group]! + 1;
					cost += tick - job.born + 1;
				}
			}
			for (let j = pending.length - 1; j >= 0; j--)
				if (pending[j]!.deadline < tick) {
					pending.splice(j, 1);
					missed++;
				}
		}
		missed += pending.length;
	}
	return {
		served,
		missed,
		cost,
		groupSpread: Math.max(...groups) - Math.min(...groups),
	};
}
