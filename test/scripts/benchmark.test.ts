import { expect, test } from "bun:test";
import {
	cp,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("performance check passes fixed workloads and rejects slow snapshot reads in an isolated copy", async () => {
	const root = resolve(import.meta.dir, "../..");
	const dir = await mkdtemp(join(tmpdir(), "pursuit-benchmark-control-"));
	try {
		for (const path of [
			"src",
			"standalone",
			"test",
			"config",
			"scripts",
			"package.json",
		])
			await cp(join(root, path), join(dir, path), { recursive: true });
		await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
		async function run() {
			const child = Bun.spawn([process.execPath, "run", "check:performance"], {
				cwd: dir,
				stdout: "pipe",
				stderr: "pipe",
			});
			const timer = setTimeout(() => child.kill(), 75000);
			try {
				const [stdout, stderr, code] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				return { stdout, stderr, code };
			} finally {
				clearTimeout(timer);
			}
		}
		const normal = await run();
		expect(normal.code, normal.stderr).toBe(0);
		const result = JSON.parse(normal.stdout);
		expect(result.budgets).toEqual({
			p95Ms: 250,
			rssMiB: 512,
			readbackMs: 5000,
		});
		expect(
			result.output.map(
				(r: { attempts: number; concurrency: number; steps: number }) => [
					r.attempts,
					r.concurrency,
					r.steps,
				],
			),
		).toEqual([
			[10, 1, 10],
			[10, 2, 20],
			[10, 4, 40],
			[100, 1, 100],
			[100, 2, 200],
			[100, 4, 400],
			[200, 1, 200],
			[200, 2, 400],
			[200, 4, 800],
		]);
		const path = join(dir, "standalone/store.ts");
		const source = await readFile(path, "utf8");
		const original =
			"serial(() => db.transaction(() => synchronous(op, ledgerDb)).deferred())";
		expect(source).toContain(original);
		await writeFile(
			path,
			source.replace(
				original,
				`serial(() => {
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
				return db.transaction(() => synchronous(op, ledgerDb)).deferred();
			})`,
			),
		);
		const slow = await run();
		expect(slow.code).not.toBe(0);
		expect(slow.stderr).toContain("performance_budget_failed");
		const failure = slow.stderr.match(
			/error: performance_budget_failed: (\{[^\n]+\})/,
		);
		expect(failure, slow.stderr).not.toBeNull();
		expect(JSON.parse(failure![1]!).p95Ms).toBeGreaterThan(
			result.budgets.p95Ms,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 120000);
