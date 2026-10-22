import type { Database } from "bun:sqlite";

const BUSY_TIMEOUT_MS = 10_000;

/**
 * Settings for a database file that several processes open at once (the settings/usage database
 * every run shares; a ledger opened by a run and by analyze/trace). Locks are waited for
 * (busy_timeout) instead of failing with SQLITE_BUSY, and WAL lets readers run beside a writer.
 *
 * Switching a fresh file to WAL needs an exclusive lock and SQLite can refuse it with SQLITE_BUSY
 * without consulting the busy handler while another process is opening the same file, so that
 * one step is retried here until the file is in WAL or the same timeout has passed.
 */
export function shareDatabase(db: Database, path: string): void {
	db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
	if (path === ":memory:") return;
	const deadline = Date.now() + BUSY_TIMEOUT_MS;
	for (let attempt = 0; ; attempt++) {
		try {
			const row = db.query("PRAGMA journal_mode = WAL;").get() as {
				journal_mode: string;
			};
			if (row.journal_mode === "wal") return;
		} catch (error) {
			if (!isBusy(error) || Date.now() >= deadline) throw error;
		}
		if (Date.now() >= deadline) throw new Error(`journal_mode_not_wal:${path}`);
		Bun.sleepSync(Math.min(10 * 2 ** attempt, 200));
	}
}

export function isBusy(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code.startsWith("SQLITE_BUSY");
}
