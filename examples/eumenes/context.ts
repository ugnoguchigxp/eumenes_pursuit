import type { Database } from "bun:sqlite";
import type { JsonValue } from "../../src/index.ts";
import { rowOf, type Reference, type State } from "./repository.ts";

export interface WebRequest {
	requestId: string;
	kind: "lookup" | "read";
	arguments: JsonValue;
	deadline: number;
	timeoutMs: number;
	parentJobId?: string | undefined;
}
export interface Context {
	store: {
		write<T>(op: (db: Database) => T): Promise<T>;
		readSnapshot<T>(op: (db: Database) => T): T;
	};
	now(): number;
	id(): string;
	web: {
		startInTransaction(
			db: Database,
			input: WebRequest,
		): { id: string; jobId: string };
	};
	source(): {
		validReferenceInTransaction(
			db: Database,
			source: State["source"],
			ref: Reference,
		): boolean;
		readReferenceInTransaction(
			db: Database,
			source: State["source"],
			ref: Reference,
			start: number,
			limit: number,
		): string;
	};
}
export function current(ctx: Context, db: Database, id: string, epoch: number) {
	const row = rowOf(db, id);
	if (!row || row.epoch !== epoch || row.closed)
		throw new Error("example_run_revoked");
	if (ctx.now() >= row.deadline) throw new Error("example_run_expired");
	return row;
}
