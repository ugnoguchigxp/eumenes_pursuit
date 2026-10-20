import { describe, expect, test } from "bun:test";
import { RevisionConflictError } from "../../src/index.ts";
import * as ledger from "../../src/domains/ledger/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { startInput } from "../support.ts";

const open = () => openStore(":memory:", migrations);

describe("ledger", () => {
	test("migration checksums are pinned", () => {
		for (const m of migrations)
			expect(new Bun.CryptoHasher("sha256").update(m.sql).digest("hex")).toBe(
				m.sha256,
			);
		expect(migrations.map((m) => m.sha256)).toEqual([
			"caea9e75215a4f062622270d9e9c14b84793fa8449774af81912ae4e513dd4ea",
			"5c45e46f0448d0f44108703a4ba96ebfbdc3ae7951d76d03efe7f0560a7b64cc",
			"79653d2dfb89864bdd9ed2f22d05a2f55822f2c9efe3ac77f7b4a291a7a79cb6",
		]);
	});

	test("acceptance is frozen once written", async () => {
		const store = open();
		await store.write((db) =>
			ledger.insertPursuit(db, {
				id: "p1",
				start: startInput(),
				status: "planning",
				now: 1,
			}),
		);
		expect(
			store.write((db) =>
				db.query("UPDATE pursuit_acceptance SET text = 'x'").run(),
			),
		).rejects.toThrow("pursuit_acceptance_frozen");
		expect(
			store.write((db) => db.query("DELETE FROM pursuit_acceptance").run()),
		).rejects.toThrow("pursuit_acceptance_frozen");
		store.close();
	});

	test("writes outside a transaction are refused", () => {
		const fake = {
			inTransaction: false,
			exec() {},
			query() {
				throw new Error("no");
			},
		};
		expect(() =>
			ledger.insertPursuit(fake, {
				id: "p",
				start: startInput(),
				status: "planning",
				now: 1,
			}),
		).toThrow("pursuit_transaction_required");
	});

	test("stale revision conflicts", async () => {
		const store = open();
		await store.write((db) =>
			ledger.insertPursuit(db, {
				id: "p1",
				start: startInput(),
				status: "planning",
				now: 1,
			}),
		);
		expect(
			await store.write((db) =>
				ledger.advancePursuit(db, {
					id: "p1",
					expectedRevision: 1,
					now: 2,
					status: "hypothesizing",
				}),
			),
		).toBe(2);
		expect(
			store.write((db) =>
				ledger.advancePursuit(db, { id: "p1", expectedRevision: 1, now: 3 }),
			),
		).rejects.toBeInstanceOf(RevisionConflictError);
		store.close();
	});

	test("operation replay and conflict", async () => {
		const store = open();
		const claim = (digest: string, pursuitId: string) =>
			store.write((db) =>
				ledger.claimOperation(db, {
					key: "k",
					kind: "start",
					digest,
					pursuitId,
					now: 1,
				}),
			);
		expect(await claim("d", "p1")).toEqual({ replayed: false });
		expect(await claim("d", "p2")).toEqual({ replayed: true, pursuitId: "p1" });
		expect(claim("other", "p3")).rejects.toThrow("operation_conflict");
		store.close();
	});

	test("full record round-trips through the view", async () => {
		const store = open();
		await store.write((db) => {
			ledger.insertPursuit(db, {
				id: "p1",
				start: startInput(),
				status: "planning",
				now: 1,
			});
			ledger.insertStrategy(db, {
				id: "s1",
				pursuitId: "p1",
				body: "方針",
				rationale: "理由",
				alternatives: ["別案"],
				previousId: null,
				now: 2,
			});
			ledger.insertHypothesis(db, {
				id: "h1",
				pursuitId: "p1",
				strategyId: "s1",
				body: "仮説",
				rationale: "r",
				tools: ["t"],
				expected: "e",
				budget: 6,
				checkpoint: "cp1",
				now: 3,
			});
			ledger.insertAttempt(db, {
				id: "a1",
				pursuitId: "p1",
				hypothesisId: "h1",
				state: "started",
				tool: "t",
				input: { path: "x" },
				prediction: { expectedStatus: "ok", expectedObservation: "見える" },
				whatChanged: "",
				fingerprint: "f",
				rejection: null,
				now: 4,
			});
			ledger.settleAttempt(db, {
				id: "a1",
				observation: {
					status: "error",
					output: { message: "m" },
					errorCode: "e",
				},
				outcome: "failure",
				refs: [],
				features: {
					filesTouched: ["x"],
					linesChanged: 2,
					protectedTouched: [],
					match: null,
					progress: null,
				},
				now: 5,
			});
			ledger.advancePursuit(db, {
				id: "p1",
				expectedRevision: 1,
				now: 6,
				status: "proposing",
				currentStrategyId: "s1",
				currentHypothesisId: "h1",
			});
		});
		const view = await store.readSnapshot((db) => ledger.loadPursuit(db, "p1"));
		expect(view?.status).toBe("proposing");
		expect(view?.strategies[0]?.alternatives).toEqual(["別案"]);
		expect(view?.attempts[0]?.observation?.errorCode).toBe("e");
		expect(view?.attempts[0]?.features?.filesTouched).toEqual(["x"]);
		expect(view?.input.policy.budget.attempts).toBeGreaterThan(0);
		store.close();
	});
});
