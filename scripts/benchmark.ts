import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../test/fixtures/crash-runner.ts";
import { startInput } from "../test/support.ts";
const output = [];
for (const attempts of [10, 100, 200])
	for (const concurrency of [1, 2, 4]) {
		const dir = await mkdtemp(join(tmpdir(), "pursuit-bench-"));
		const hosts = Array.from({ length: concurrency }, (_, i) =>
			fixture(":memory:", join(dir, `marker-${i}`), null),
		);
		const latencies: number[] = [];
		try {
			await Promise.all(
				hosts.map(async (f) => {
					const input = startInput();
					input.policy = {
						...input.policy,
						budget: {
							...input.policy.budget,
							attempts: attempts + 10,
							attemptsPerHypothesis: attempts + 10,
							transitions: 10000,
						},
					};
					const { pursuitId: id } = await f.engine.start(input, "benchmark");
					await f.engine.step(id, f.runtime, AbortSignal.timeout(60000));
					await f.engine.step(id, f.runtime, AbortSignal.timeout(60000));
					for (let i = 0; i < attempts; i++) {
						const t = performance.now();
						await f.engine.step(id, f.runtime, AbortSignal.timeout(60000));
						latencies.push(performance.now() - t);
					}
					const view = await f.engine.view(id);
					if (view?.attempts.length !== attempts)
						throw new Error("benchmark_count");
					const t = performance.now();
					await f.engine.view(id);
					if (performance.now() - t > 5000) throw new Error("recovery_budget");
				}),
			);
			latencies.sort((a, b) => a - b);
			const rss = process.memoryUsage().rss / 1024 / 1024,
				p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
			output.push({
				attempts,
				concurrency,
				steps: latencies.length,
				p50Ms: latencies[Math.floor(latencies.length * 0.5)],
				p95Ms: p95,
				rssMiB: rss,
			});
			if (p95 > 250 || rss > 512) throw new Error("performance_budget_failed");
		} finally {
			for (const f of hosts) f.store.close();
			await rm(dir, { recursive: true, force: true });
			Bun.gc(true);
		}
	}
console.log(
	JSON.stringify(
		{
			bun: Bun.version,
			platform: process.platform,
			arch: process.arch,
			model: "deterministic fixture; external latency excluded",
			output,
		},
		null,
		2,
	),
);
