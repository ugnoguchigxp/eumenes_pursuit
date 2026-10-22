import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Several runner processes start at once against the same files: the settings/usage database is
// shared by every run, and a ledger can be opened by a run and by analyze/trace. None may fail with
// SQLITE_BUSY, and every write must land once, under the job that made it.
const here = import.meta.dir;
const settingsModule = resolve(here, "../settings.ts");
const storeModule = resolve(here, "../store.ts");
const sqliteModule = resolve(here, "../../src/sqlite.ts");

async function together(
	workers: string[],
): Promise<{ code: number; err: string }[]> {
	const start = Date.now() + 500; // let every process load before any opens the file
	const procs = workers.map((src) =>
		Bun.spawn(
			[process.execPath, "-e", `while (Date.now() < ${start}) {}\n${src}`],
			{ stdout: "ignore", stderr: "pipe" },
		),
	);
	return Promise.all(
		procs.map(async (p) => ({
			code: await p.exited,
			err: await new Response(p.stderr).text(),
		})),
	);
}

test("three processes open a fresh settings database at once and record usage concurrently", async () => {
	const dir = mkdtempSync(join(tmpdir(), "settings-mp-"));
	const path = join(dir, "settings.sqlite");
	const perJob = 60;
	try {
		const worker = (job: string) => `
			const { openSettings } = await import(${JSON.stringify(settingsModule)});
			const s = openSettings(${JSON.stringify(path)});
			s.set("spend.limitUsd", 100);
			s.set("spend.pricing", { m: { input: 2, output: 10 } });
			const meter = s.meter({ runId: "run-${job}", configId: "cfg", jobId: "${job}", pursuitId: "p-${job}" }, "generator");
			for (let i = 0; i < ${perJob}; i++) {
				meter.assertWithinLimit();
				meter.record("m", { input_tokens: 10, output_tokens: 1 }, { callId: "${job}-" + i, requestedModel: "m", status: "response", latencyMs: 1 });
			}
			s.close();`;
		const results = await together(["a", "b", "c"].map(worker));
		for (const r of results) {
			expect(r.err).not.toContain("SQLITE_BUSY");
			expect(r.code).toBe(0);
		}
		const db = new Database(path, { readonly: true });
		const rows = db
			.query(
				"SELECT job_id, COUNT(*) AS n, COUNT(spend_id) AS spent, COUNT(DISTINCT call_id) AS calls FROM usage_call GROUP BY job_id ORDER BY job_id",
			)
			.all();
		expect(rows).toEqual(
			["a", "b", "c"].map((job_id) => ({
				job_id,
				n: perJob,
				spent: perJob,
				calls: perJob,
			})),
		);
		// Each usage row names its own job in the stored event too.
		const mismatched = db
			.query(
				"SELECT COUNT(*) AS n FROM usage_call WHERE json_extract(event_json, '$.scope.jobId') != job_id OR substr(call_id, 1, 1) != job_id",
			)
			.get() as { n: number };
		expect(mismatched.n).toBe(0);
		expect(
			(db.query("SELECT COUNT(*) AS n FROM spend").get() as { n: number }).n,
		).toBe(3 * perJob);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 30_000);

test("three processes open a fresh ledger at once: migrations apply once and every write lands", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ledger-mp-"));
	const path = join(dir, "ledger.sqlite");
	const perProc = 40;
	try {
		const worker = (tag: string) => `
			const { openStore } = await import(${JSON.stringify(storeModule)});
			const { migrations } = await import(${JSON.stringify(sqliteModule)});
			const store = openStore(${JSON.stringify(path)}, migrations);
			await store.write((db) => db.exec("CREATE TABLE IF NOT EXISTS mp_probe (tag TEXT NOT NULL, i INTEGER NOT NULL)"));
			for (let i = 0; i < ${perProc}; i++)
				await store.write((db) => {
					const n = db.query("SELECT COUNT(*) AS n FROM mp_probe WHERE tag = ?").get("${tag}").n;
					db.query("INSERT INTO mp_probe (tag, i) VALUES (?, ?)").run("${tag}", n);
				});
			await store.readSnapshot((db) => db.query("SELECT COUNT(*) FROM mp_probe").get());
			store.close();`;
		const results = await together(["x", "y", "z"].map(worker));
		for (const r of results) {
			expect(r.err).toBe("");
			expect(r.code).toBe(0);
		}
		const db = new Database(path, { readonly: true });
		const { migrations } = await import(sqliteModule);
		expect(
			db.query("SELECT id FROM schema_migrations ORDER BY id").all(),
		).toEqual(
			[...migrations]
				.map((m: { id: string }) => ({ id: m.id }))
				.sort((a, b) => (a.id < b.id ? -1 : 1)),
		);
		// Read-then-write inside one write() is atomic per process: 0..n-1 with no gaps or repeats.
		for (const tag of ["x", "y", "z"])
			expect(
				(
					db
						.query("SELECT i FROM mp_probe WHERE tag = ? ORDER BY i")
						.all(tag) as { i: number }[]
				).map((r) => r.i),
			).toEqual([...Array(perProc).keys()]);
		expect(
			(db.query("PRAGMA journal_mode").get() as { journal_mode: string })
				.journal_mode,
		).toBe("wal");
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 30_000);
