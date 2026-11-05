import type { Database } from "bun:sqlite";
import type { UsageCall, UsageEvent, UsageScope } from "./usage.ts";

const MICRO = 1_000_000;
const money = (usd: number) => {
	if (
		!Number.isFinite(usd) ||
		usd < 0 ||
		!Number.isSafeInteger(Math.ceil(usd * MICRO))
	)
		throw new Error("invalid_usd");
	return Math.ceil(usd * MICRO);
};
type Reservation = {
	call_id: string;
	scope_json: string;
	provider: string;
	upper_micro: number;
	state: string;
};
type Resolution = {
	call_id: string;
	usd_micro: number;
	actor: string;
	basis: string;
	kind: string;
	at: number;
};

/** Host accounting: the same durable writer gates every in-flight request. */
export function openBudget(db: Database, globalLimit: () => number) {
	db.exec(`CREATE TABLE IF NOT EXISTS billing_reservation (
 call_id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, provider TEXT NOT NULL,
 upper_micro INTEGER NOT NULL CHECK(upper_micro >= 0), state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','uncertain','settled','released','reconciled')), at INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS billing_limit (key TEXT PRIMARY KEY, limit_micro INTEGER NOT NULL CHECK(limit_micro >= 0)) STRICT;
 CREATE TABLE IF NOT EXISTS billing_reconciliation (call_id TEXT PRIMARY KEY, usd_micro INTEGER NOT NULL CHECK(usd_micro >= 0), actor TEXT NOT NULL, basis TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('invoice','upper_bound')), at INTEGER NOT NULL) STRICT;
 CREATE TRIGGER IF NOT EXISTS billing_reconciliation_no_update BEFORE UPDATE ON billing_reconciliation BEGIN SELECT RAISE(ABORT,'reconciliation_immutable'); END;
 CREATE TRIGGER IF NOT EXISTS billing_reconciliation_no_delete BEFORE DELETE ON billing_reconciliation BEGIN SELECT RAISE(ABORT,'reconciliation_immutable'); END;`);
	const keys = (scope: UsageScope | null, provider: string) => [
		"global",
		`provider:${provider}`,
		...(scope
			? [
					`run:${scope.runId}`,
					`job:${scope.jobId}`,
					...(scope.budgetId
						? [
								`campaign:${scope.budgetId}`,
								`campaign:${scope.budgetId}:provider:${provider}`,
							]
						: []),
				]
			: []),
	];
	function resolutions() {
		return new Map(
			(
				db.query("SELECT * FROM billing_reconciliation").all() as Resolution[]
			).map((r) => [r.call_id, r]),
		);
	}
	function exposure(key: string): number {
		const resolved = resolutions();
		const pending = db
			.query(
				"SELECT * FROM billing_reservation WHERE state IN ('reserved','dispatched','uncertain')",
			)
			.all() as Reservation[];
		const pendingIds = new Set(pending.map((r) => r.call_id));
		let value = 0;
		for (const row of db.query("SELECT event_json FROM usage_call").all() as {
			event_json: string;
		}[]) {
			const event = JSON.parse(row.event_json) as UsageEvent;
			const provider = event.provider ?? "claude";
			if (!keys(event.scope, provider).includes(key)) continue;
			if (event.usd !== null) value += money(event.usd);
			else if (resolved.has(event.callId))
				value += resolved.get(event.callId)!.usd_micro;
			else if (
				["claude", "openai"].includes(provider) &&
				!pendingIds.has(event.callId)
			)
				return Infinity;
		}
		if (key === "global") {
			const rows = db
				.query(
					"SELECT usd FROM spend WHERE id NOT IN (SELECT spend_id FROM usage_call WHERE spend_id IS NOT NULL)",
				)
				.all() as { usd: number }[];
			for (const r of rows) value += money(r.usd);
		}
		for (const r of pending)
			if (
				keys(
					JSON.parse(r.scope_json) as UsageScope | null,
					r.provider,
				).includes(key)
			)
				value += r.upper_micro;
		return value;
	}
	function limit(key: string): number | undefined {
		if (key === "global") return money(globalLimit());
		return (
			db
				.query("SELECT limit_micro FROM billing_limit WHERE key=?")
				.get(key) as { limit_micro: number } | null
		)?.limit_micro;
	}
	return {
		exposureUsd: (key = "global") => exposure(key) / MICRO,
		setLimit(key: string, usd: number) {
			if (key === "global" || !key.trim())
				throw new Error("invalid_budget_key");
			db.transaction(() => {
				const amount = money(usd);
				if (amount < exposure(key)) throw new Error("limit_below_exposure");
				db.query(
					"INSERT INTO billing_limit(key,limit_micro) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET limit_micro=excluded.limit_micro",
				).run(key, amount);
			}).immediate();
		},
		reserve(call: UsageCall, scope: UsageScope | null, upperUsd: number) {
			db.transaction(() => {
				const upper = money(upperUsd),
					provider = call.provider ?? "claude";
				const prior = db
					.query("SELECT * FROM billing_reservation WHERE call_id=?")
					.get(call.callId) as Reservation | null;
				if (prior) throw new Error("reservation_exists");
				for (const key of keys(scope, provider)) {
					const cap = limit(key);
					if (cap !== undefined && exposure(key) + upper > cap)
						throw new Error(`spend_limit_reached_or_usage_unknown:${key}`);
				}
				db.query("INSERT INTO billing_reservation VALUES (?,?,?,?,?,?)").run(
					call.callId,
					JSON.stringify(scope),
					provider,
					upper,
					"reserved",
					Date.now(),
				);
			}).immediate();
		},
		dispatch(callId: string) {
			const r = db
				.query(
					"UPDATE billing_reservation SET state='dispatched' WHERE call_id=? AND state='reserved'",
				)
				.run(callId);
			if (r.changes !== 1) throw new Error("reservation_not_dispatchable");
		},
		release(callId: string) {
			const r = db
				.query(
					"UPDATE billing_reservation SET state='released' WHERE call_id=? AND state='reserved'",
				)
				.run(callId);
			if (r.changes !== 1) throw new Error("dispatched_cost_is_uncertain");
		},
		uncertain(callId: string) {
			db.query(
				"UPDATE billing_reservation SET state='uncertain' WHERE call_id=? AND state IN ('reserved','dispatched')",
			).run(callId);
		},
		settle(callId: string, usd: number) {
			const r = db
				.query("SELECT upper_micro FROM billing_reservation WHERE call_id=?")
				.get(callId) as { upper_micro: number } | null;
			db.query(
				"UPDATE billing_reservation SET state='settled' WHERE call_id=? AND state IN ('reserved','dispatched','uncertain')",
			).run(callId);
			return !r || money(usd) <= r.upper_micro;
		},
		reconcile(
			callId: string,
			usd: number,
			actor: string,
			basis: string,
			kind: "invoice" | "upper_bound",
		) {
			if (!actor.trim() || !basis.trim())
				throw new Error("reconciliation_evidence_required");
			db.transaction(() => {
				const raw = db
					.query("SELECT event_json FROM usage_call WHERE call_id=?")
					.get(callId) as { event_json: string } | null;
				const reservation = db
					.query("SELECT * FROM billing_reservation WHERE call_id=?")
					.get(callId) as Reservation | null;
				if (
					(!raw || (JSON.parse(raw.event_json) as UsageEvent).usd !== null) &&
					!reservation
				)
					throw new Error("unknown_call_not_found");
				if (raw && (JSON.parse(raw.event_json) as UsageEvent).usd !== null)
					throw new Error("known_call_cannot_be_reconciled");
				const amount = money(usd);
				if (kind === "upper_bound" && amount === 0)
					throw new Error("positive_upper_bound_required");
				const old = db
					.query("SELECT * FROM billing_reconciliation WHERE call_id=?")
					.get(callId) as Resolution | null;
				if (old) {
					if (
						old.usd_micro === amount &&
						old.actor === actor &&
						old.basis === basis &&
						old.kind === kind
					)
						return;
					throw new Error("reconciliation_conflict");
				}
				if (
					reservation &&
					(amount > reservation.upper_micro ||
						!["dispatched", "uncertain"].includes(reservation.state))
				)
					throw new Error("invalid_reservation_resolution");

				// A crashed dispatched request may not yet have produced a usage event.
				if (!raw && reservation) {
					const event: UsageEvent = {
						callId,
						provider: reservation.provider as NonNullable<
							UsageEvent["provider"]
						>,
						requestedModel: "unavailable",
						latencyMs: 0,
						status: "error",
						scope: JSON.parse(reservation.scope_json) as UsageScope | null,
						role: "unattributed",
						servedModel: null,
						inputTokens: null,
						outputTokens: null,
						cacheReadTokens: null,
						cacheWriteTokens: null,
						pricingVersion: "unavailable",
						costStatus: "unknown",
						usd: null,
					};
					db.query(
						"INSERT INTO usage_call(call_id,job_id,event_json,spend_id) VALUES (?,?,?,NULL)",
					).run(callId, event.scope?.jobId ?? null, JSON.stringify(event));
				}
				db.query("INSERT INTO billing_reconciliation VALUES (?,?,?,?,?,?)").run(
					callId,
					amount,
					actor,
					basis,
					kind,
					Date.now(),
				);
				db.query(
					"UPDATE billing_reservation SET state='reconciled' WHERE call_id=?",
				).run(callId);
			}).immediate();
		},
		resolvedEvents(events: UsageEvent[]): UsageEvent[] {
			const resolved = resolutions();
			return events.map((e) => {
				const r = resolved.get(e.callId);
				return r
					? {
							...e,
							usd: r.usd_micro / MICRO,
							costStatus: r.kind === "invoice" ? "known" : "estimated",
							reconciliation: {
								actor: r.actor,
								basis: r.basis,
								kind: r.kind,
								at: r.at,
							},
						}
					: e;
			});
		},
		snapshot() {
			return {
				exposureUsd: exposure("global") / MICRO,
				limits: db.query("SELECT * FROM billing_limit").all(),
				reservations: db
					.query(
						"SELECT * FROM billing_reservation WHERE state IN ('reserved','dispatched','uncertain')",
					)
					.all(),
				reconciliations: db.query("SELECT * FROM billing_reconciliation").all(),
			};
		},
	};
}
