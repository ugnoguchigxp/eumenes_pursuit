import { requireTransaction, type LedgerDb } from "../../contracts/index.ts";
import type { FindingRow } from "./types.ts";

export function insertFinding(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		kind: FindingRow["kind"];
		statement: string;
		assurance: FindingRow["assurance"];
		sourceAttemptId: string | null;
		sourceVerificationId?: string | null;
		scope: FindingRow["scope"];
		strategyId: string | null;
		hypothesisId: string | null;
		now: number;
	},
): void {
	requireTransaction(db);
	const seq = (
		db
			.query(
				"SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM pursuit_finding WHERE pursuit_id = ?",
			)
			.get(input.pursuitId) as { seq: number }
	).seq;
	db.query(
		`INSERT INTO pursuit_finding (id, pursuit_id, seq, kind, statement, assurance, source_attempt_id, scope, strategy_id, hypothesis_id, status, created_at, source_verification_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		seq,
		input.kind,
		input.statement,
		input.assurance,
		input.sourceAttemptId,
		input.scope,
		input.strategyId,
		input.hypothesisId,
		input.now,
		input.sourceVerificationId ?? null,
	);
}

/** active → superseded / refuted. Never deletes: the record of what was believed stays. */
export function closeFinding(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		status: "superseded" | "refuted";
		reason: string;
		now: number;
	},
): boolean {
	requireTransaction(db);
	const result = db
		.query(
			"UPDATE pursuit_finding SET status = ?, reason = ?, closed_at = ? WHERE id = ? AND pursuit_id = ? AND status = 'active'",
		)
		.run(input.status, input.reason, input.now, input.id, input.pursuitId);
	return (result as { changes?: number }).changes === 1;
}

/** A revised strategy supersedes the findings that stood on it (dead ends excepted). */
export function supersedeStrategyFindings(
	db: LedgerDb,
	input: { pursuitId: string; strategyId: string; reason: string; now: number },
): void {
	requireTransaction(db);
	db.query(
		"UPDATE pursuit_finding SET status = 'superseded', reason = ?, closed_at = ? WHERE pursuit_id = ? AND strategy_id = ? AND scope = 'strategy' AND kind != 'dead_end' AND status = 'active'",
	).run(input.reason, input.now, input.pursuitId, input.strategyId);
}

export function loadFindings(db: LedgerDb, pursuitId: string): FindingRow[] {
	return (
		db
			.query("SELECT * FROM pursuit_finding WHERE pursuit_id = ? ORDER BY seq")
			.all(pursuitId) as Record<string, unknown>[]
	).map((r) => ({
		id: String(r.id),
		seq: Number(r.seq),
		kind: r.kind as FindingRow["kind"],
		statement: String(r.statement),
		assurance: r.assurance as FindingRow["assurance"],
		sourceAttemptId:
			r.source_attempt_id === null ? null : String(r.source_attempt_id),
		sourceVerificationId:
			r.source_verification_id === null
				? null
				: String(r.source_verification_id),
		scope: r.scope as FindingRow["scope"],
		strategyId: r.strategy_id === null ? null : String(r.strategy_id),
		hypothesisId: r.hypothesis_id === null ? null : String(r.hypothesis_id),
		status: r.status as FindingRow["status"],
		reason: r.reason === null ? null : String(r.reason),
	}));
}

/** Exact claim identity; never merge different premises or infer semantic equivalence. */
export function findingClaimKey(
	f: Pick<
		FindingRow,
		"kind" | "statement" | "scope" | "strategyId" | "hypothesisId"
	>,
): string {
	return JSON.stringify([
		f.kind,
		f.statement,
		f.scope,
		f.strategyId,
		f.hypothesisId,
	]);
}
export function findingEvidenceKey(
	f: Pick<
		FindingRow,
		| "kind"
		| "statement"
		| "scope"
		| "strategyId"
		| "hypothesisId"
		| "assurance"
		| "sourceAttemptId"
		| "sourceVerificationId"
	>,
): string {
	return JSON.stringify([
		findingClaimKey(f),
		f.assurance,
		f.sourceAttemptId,
		f.sourceVerificationId ?? null,
	]);
}
