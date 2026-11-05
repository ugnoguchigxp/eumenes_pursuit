import {
	expectChanges,
	requireTransaction,
	type LedgerDb,
} from "../../contracts/index.ts";

/** Find a committed core even if the host crashed before saving its correspondence. */
export function findPursuitByOperation(
	db: LedgerDb,
	key: string,
): string | null {
	const row = db
		.query(
			"SELECT pursuit_id FROM pursuit_operation WHERE operation_key=? AND forgotten_at IS NULL",
		)
		.get(key) as { pursuit_id: string } | null;
	return row?.pursuit_id ?? null;
}

export function deferAttempt(
	db: LedgerDb,
	id: string,
	operationId: string,
): void {
	requireTransaction(db);
	if (
		typeof operationId !== "string" ||
		!operationId.trim() ||
		operationId.length > 256
	)
		throw new Error("invalid_deferred_tool");
	expectChanges(
		db
			.query(
				"UPDATE pursuit_attempt SET pending_operation_id=? WHERE id=? AND state='started' AND pending_operation_id IS NULL",
			)
			.run(operationId, id),
		1,
		"attempt_defer",
	);
}

/** Host-only erasure. Keep opaque tombstones so delayed jobs cannot recreate old inputs. */
export function forgetPursuit(
	db: LedgerDb,
	pursuitId: string,
	now: number,
): boolean {
	requireTransaction(db);
	const row = db
		.query("SELECT forgotten_at FROM pursuit_pursuit WHERE id=?")
		.get(pursuitId) as { forgotten_at: number | null } | null;
	if (!row || row.forgotten_at !== null) return false;
	db.query(
		"UPDATE pursuit_pursuit SET goal='', input_json='{}', status='stopped', current_strategy_id=NULL, current_hypothesis_id=NULL, forgotten_at=?, updated_at=?, finished_at=?, revision=revision+1 WHERE id=?",
	).run(now, now, now, pursuitId);
	db.query(
		"UPDATE pursuit_operation SET digest='', forgotten_at=? WHERE pursuit_id=?",
	).run(now, pursuitId);
	for (const table of [
		"pursuit_finding",
		"pursuit_report",
		"pursuit_verification",
		"pursuit_judgement",
		"pursuit_decision",
		"pursuit_consultation",
		"pursuit_inference",
		"pursuit_attempt",
		"pursuit_hypothesis",
		"pursuit_strategy",
		"pursuit_acceptance",
	])
		db.query(`DELETE FROM ${table} WHERE pursuit_id=?`).run(pursuitId);
	return true;
}
