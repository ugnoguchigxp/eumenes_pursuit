/** Separate deterministic host-queue measurement; never uses an API or enlarges the slot. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LlmPort } from "../src/index.ts";
import { fixture, scripted } from "../examples/eumenes/fixtures.ts";
import { delay, openExample } from "../examples/eumenes/host.ts";

const root = resolve(process.argv[2] ?? "artifacts/eumenes-contention");
mkdirSync(root, { recursive: true });
const summary = [];
for (const execution of ["legacy", "productive"] as const) {
	let tail = Promise.resolve();
	let active = 0,
		peak = 0;
	const observations: {
		job: string;
		purpose: string;
		queueMs: number;
		serviceMs: number;
	}[] = [];
	const slot = (job: string, port: LlmPort): LlmPort => ({
		complete(request, signal) {
			const queued = performance.now();
			const run = tail.then(async () => {
				const started = performance.now();
				active++;
				peak = Math.max(active, peak);
				try {
					await delay(16, signal);
					return await port.complete(request, signal);
				} finally {
					active--;
					observations.push({
						job,
						purpose: request.purpose,
						queueMs: started - queued,
						serviceMs: performance.now() - started,
					});
				}
			});
			tail = run.then(
				() => {},
				() => {},
			);
			return run;
		},
	});
	const hosts = [];
	try {
		for (const name of ["museum", "technical"] as const) {
			const f = fixture(name, { lookup: 24, read: 24, stagger: 24 });
			hosts.push(
				await openExample({
					directory: resolve(root, execution, name),
					request: f.request,
					limits: f.limits,
					web: f.web,
					generator: slot(name, scripted(name, { think: true })),
					execution,
				}),
			);
		}
		const started = performance.now();
		const results = await Promise.all(hosts.map((host) => host.drive()));
		if (peak !== 1 || results.some((result) => !result.view.report?.verified))
			throw new Error("contention_trial_failed");
		summary.push({
			execution,
			peak,
			elapsedMs: performance.now() - started,
			queueMs: observations.reduce((sum, o) => sum + o.queueMs, 0),
			observations,
		});
	} finally {
		await Promise.all(hosts.map((host) => host.close()));
	}
}
writeFileSync(
	resolve(root, "contention.json"),
	JSON.stringify(summary, null, 2) + "\n",
);
