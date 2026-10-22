import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isAsyncFunction } from "node:util/types";
import { shareDatabase } from "./sqlite-shared.ts";
import type {
	LedgerDb,
	MigrationDescriptor,
	PursuitStore,
} from "../src/contracts/index.ts";

function synchronous<T>(op: (db: LedgerDb) => T, db: LedgerDb): T {
	if (isAsyncFunction(op)) throw new Error("async_transaction_callback");
	const value = op(db);
	if (
		value !== null &&
		typeof value === "object" &&
		"then" in value &&
		typeof value.then === "function"
	)
		throw new Error("async_transaction_callback");
	return value;
}

export interface StandaloneStore extends PursuitStore {
	readonly path: string;
	close(): void;
}

/**
 * Stand-in for the host's single writer: one connection, WAL, every callback in
 * a transaction. Eumenes replaces this with its own store.
 */
export function openStore(
	path: string,
	migrations: readonly MigrationDescriptor[],
): StandaloneStore {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true, strict: true });
	db.exec("PRAGMA foreign_keys = ON;");
	// Other processes may open the same ledger (analyze / trace beside a run, or a second runner).
	shareDatabase(db, path);
	db.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)",
	);
	const applied = new Map(
		(
			db.query("SELECT id, sha256 FROM schema_migrations").all() as {
				id: string;
				sha256: string;
			}[]
		).map((row) => [row.id, row.sha256]),
	);
	for (const migration of migrations) {
		const sha = new Bun.CryptoHasher("sha256")
			.update(migration.sql)
			.digest("hex");
		if (sha !== migration.sha256)
			throw new Error(`migration_checksum:${migration.id}`);
		const done = applied.get(migration.id);
		if (done === migration.sha256) continue;
		if (done !== undefined)
			throw new Error(`migration_changed:${migration.id}`);
		// Under the write lock, re-check: another process opening the same file may have applied
		// it since the read above.
		db.transaction(() => {
			const now = db
				.query("SELECT sha256 FROM schema_migrations WHERE id = ?")
				.get(migration.id) as { sha256: string } | null;
			if (now?.sha256 === migration.sha256) return;
			if (now) throw new Error(`migration_changed:${migration.id}`);
			db.exec(migration.sql);
			db.query(
				"INSERT INTO schema_migrations (id, sha256, applied_at) VALUES (?, ?, ?)",
			).run(migration.id, migration.sha256, Date.now());
		}).immediate();
	}
	const ledgerDb: Database & LedgerDb = db;
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(op: () => T): Promise<T> => {
		const next = queue.then(op);
		queue = next.catch(() => undefined);
		return next;
	};
	return {
		path,
		write: (op) =>
			serial(() => db.transaction(() => synchronous(op, ledgerDb)).immediate()),
		readSnapshot: (op) =>
			serial(() => db.transaction(() => synchronous(op, ledgerDb)).deferred()),
		close: () => db.close(),
	};
}
