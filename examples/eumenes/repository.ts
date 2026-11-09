import type { Database } from "bun:sqlite";
import type { ResearchDraft } from "./contracts.ts";

export interface Reference {
	ref: string;
	kind: "message" | "memory";
	id: string;
	description: string;
}
export interface State {
	source: { request: string; amendments: unknown[]; responses: unknown[] };
	request: string;
	instructions: string;
	references: Reference[];
	saveDocument: boolean;
	draft: ResearchDraft | null;
	snapshots: Record<string, ResearchDraft | null>;
	modelCalls: number;
	webCalls: number;
	searches: number;
	limits: { modelCalls: number; childCalls: number; searches: number };
	inferenceMs: number;
}
export interface Row {
	id: string;
	epoch: number;
	core_id: string | null;
	job_id: string | null;
	deadline: number;
	closed: number;
	data_json: string;
}
export interface Document {
	id: string;
	url: string;
	title: string;
	text: string;
	fetched_at: number;
	truncated: number;
}

export function rowOf(db: Database, id: string) {
	return db
		.query<Row, [string]>("SELECT * FROM pursuit_runs WHERE id=?")
		.get(id);
}
export function stateOf(row: Row): State {
	return JSON.parse(row.data_json);
}
export function save(db: Database, row: Row, state: State, now: number) {
	const result = db
		.query(
			"UPDATE pursuit_runs SET data_json=?,updated_at=? WHERE id=? AND epoch=? AND closed=0",
		)
		.run(JSON.stringify(state), now, row.id, row.epoch);
	if (result.changes !== 1) throw new Error("example_run_revoked");
}
export function documents(db: Database, row: Row): Document[] {
	return db
		.query<Document, [string, number]>(
			"SELECT id,url,title,text,fetched_at,truncated FROM pursuit_documents WHERE run_id=? AND epoch=? ORDER BY rowid",
		)
		.all(row.id, row.epoch);
}
