/** Minimal synchronous port, structurally satisfied by bun:sqlite Database. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface LedgerStatement {
	all(...params: SqlValue[]): unknown[];
	get(...params: SqlValue[]): unknown;
	run(...params: SqlValue[]): unknown;
}

/**
 * The host owns this connection and its transaction. Never retain it across calls.
 * exec exists for schema SQL only, not BEGIN/COMMIT/PRAGMA.
 */
export interface LedgerDb {
	readonly inTransaction: boolean;
	exec(sql: string): void;
	query(sql: string): LedgerStatement;
}

type SyncResult<T> = T extends PromiseLike<unknown> ? never : T;

/**
 * The host's single-writer store (Eumenes `store.write` / `store.readSnapshot`).
 * Callbacks are synchronous and run inside a transaction the host opened.
 */
export interface PursuitStore {
	write<T>(op: (db: LedgerDb) => SyncResult<T>): Promise<T>;
	readSnapshot<T>(op: (db: LedgerDb) => SyncResult<T>): Promise<T>;
}

/** Immutable migration: sha256 of the exact `sql` UTF-8 bytes. */
export interface MigrationDescriptor {
	readonly id: string;
	readonly sql: string;
	readonly sha256: string;
}

export class LedgerTransactionRequiredError extends Error {
	constructor() {
		super("pursuit_transaction_required");
		this.name = "LedgerTransactionRequiredError";
	}
}

/** Unexpected row counts or inconsistent state after DML: the host must roll back. */
export class LedgerIntegrityError extends Error {
	constructor(readonly reasonCode: string) {
		super(`pursuit_integrity:${reasonCode}`);
		this.name = "LedgerIntegrityError";
	}
}

/** A write lost a race: the pursuit changed since it was read. */
export class RevisionConflictError extends Error {
	constructor(
		readonly expected: number,
		readonly actual: number,
	) {
		super(`pursuit_revision_conflict:${expected}:${actual}`);
		this.name = "RevisionConflictError";
	}
}

export function requireTransaction(db: LedgerDb): void {
	if ((db as { inTransaction?: unknown }).inTransaction !== true)
		throw new LedgerTransactionRequiredError();
}

export function expectChanges(
	result: unknown,
	count: number,
	reasonCode: string,
): void {
	const changes = (result as { changes?: unknown } | undefined)?.changes;
	if (changes !== count) throw new LedgerIntegrityError(reasonCode);
}
