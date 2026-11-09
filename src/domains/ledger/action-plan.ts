import { requireTransaction, type LedgerDb } from "../../contracts/index.ts";
import type { ActionPlan } from "./types.ts";

/** The same writer transaction also commits the attempt that consumes/creates this plan. */
export function setActionPlan(
	db: LedgerDb,
	pursuitId: string,
	plan: ActionPlan | null,
) {
	requireTransaction(db);
	db.query("UPDATE pursuit_pursuit SET action_plan_json=? WHERE id=?").run(
		plan ? JSON.stringify(plan) : null,
		pursuitId,
	);
}
