import {
	requireTransaction,
	type LedgerDb,
	type CriterionResult,
} from "../../contracts/index.ts";
import type { PlannedAction } from "./types.ts";

export interface ProgressVerdict {
	assessed: number[];
	kind:
		| "initial"
		| "evidence"
		| "constraint"
		| "reasoning"
		| "artifact"
		| "none"
		| "blocked";
	change: string;
	criteria: string[];
	evidence: number[];
	conclusions: string[];
}
export interface ProductiveChoice {
	basis: string;
	progress: ProgressVerdict;
	choice: "act" | "think" | "wait" | "complete" | "partial" | "consult";
	reason: string;
	missing: string;
	contribution: string;
	route: "advance" | "alternative" | "checkpoint" | "verify";
	actions: PlannedAction[];
	sequence: boolean;
	cancelPending: boolean;
	waitAfterDispatch: boolean;
	renewHypothesis: { body: string; expected: string; targets: string[] } | null;
	renewStrategy: {
		body: string;
		rationale: string;
		alternatives: string[];
		parts: string[];
	} | null;
}
export interface ProductivePlan {
	actions: PlannedAction[];
	sequence: boolean;
	/** A renewed strategy's leading write must settle before its other actions. */
	waitForCheckpoint?: true;
	finish: "completed" | "incomplete" | null;
	reason: string;
	cancelPending: boolean;
	waitAfterDispatch: boolean;
	digest: string | null;
	toolsDigest: string;
	facts: string;
	owned: string[];
	awaiting: string | null;
}
export interface ProductiveState {
	request: {
		id: string;
		basis: string;
		workspace: string | null;
		assessed: number[];
		system: string;
		prompt: string;
		maxOutputTokens: number;
	} | null;
	assessed: number[];
	thought: number;
	notes: string[];
	waitBasis: string | null;
	repair: { basis: string; issues: string[] } | null;
	plan: ProductivePlan | null;
	verification: {
		basis: string;
		criteria: readonly CriterionResult[];
		passed: boolean;
	} | null;
	workspaceAtAssessment: string | null;
}
export interface ProgressRecord {
	id: string;
	basis: string;
	verdict: ProgressVerdict;
	choice: ProductiveChoice;
	model: string;
	at: number;
	assurance: "model";
	status?: "accepted" | "superseded";
	reusedArtifact?: { write: number; readBack: number };
}
export const emptyProductiveState = (): ProductiveState => ({
	request: null,
	assessed: [],
	thought: 0,
	notes: [],
	waitBasis: null,
	repair: null,
	plan: null,
	verification: null,
	workspaceAtAssessment: null,
});
export function setProductiveState(
	db: LedgerDb,
	id: string,
	state: ProductiveState | null,
) {
	requireTransaction(db);
	db.query("UPDATE pursuit_pursuit SET productive_json=? WHERE id=?").run(
		state ? JSON.stringify(state) : null,
		id,
	);
}
export function clearProductivePlan(db: LedgerDb, id: string) {
	requireTransaction(db);
	const r = db
		.query("SELECT productive_json FROM pursuit_pursuit WHERE id=?")
		.get(id) as { productive_json: string | null } | null;
	if (!r?.productive_json) return;
	const s = JSON.parse(r.productive_json) as ProductiveState;
	setProductiveState(db, id, {
		...s,
		plan: null,
		waitBasis: null,
		repair: null,
		request: null,
	});
}
export function insertProgress(
	db: LedgerDb,
	pursuitId: string,
	row: ProgressRecord,
) {
	requireTransaction(db);
	db.query(
		"INSERT INTO pursuit_progress(id,pursuit_id,data_json) VALUES (?,?,?)",
	).run(row.id, pursuitId, JSON.stringify(row));
}
export function loadProgress(db: LedgerDb, id: string): ProgressRecord[] {
	return (
		db
			.query(
				"SELECT data_json FROM pursuit_progress WHERE pursuit_id=? ORDER BY rowid",
			)
			.all(id) as { data_json: string }[]
	).map((r) => JSON.parse(r.data_json));
}
