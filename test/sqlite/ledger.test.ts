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
			"c7af35e2971ff35b21f96a8312c61940561a81ba6ca3aa9813fbecc9ede1336b",
			"5b8d4499ad9382fe54118585cdf4c6a3c50b5be6de329addd19f96f28ed6f9b0",
			"3db990ae902fba0c296ebde600a2dfc220cc3b768b7824be36dcf41c0b5c032e",
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

test("additive recovery migration conservatively marks legacy active tails only", async () => {
	const store = openStore(":memory:", migrations.slice(0, 3));
	try {
		await store.write((db) => {
			for (const [id, status] of [
				["active", "proposing"],
				["finished", "completed"],
			] as const) {
				ledger.insertPursuit(db, { id, start: startInput(), status, now: 1 });
				ledger.insertStrategy(db, {
					id: `s-${id}`,
					pursuitId: id,
					body: "s",
					rationale: "r",
					alternatives: [],
					previousId: null,
					now: 1,
				});
				ledger.insertHypothesis(db, {
					id: `h-${id}`,
					pursuitId: id,
					strategyId: `s-${id}`,
					body: "h",
					rationale: "r",
					tools: ["read"],
					expected: "e",
					budget: 5,
					checkpoint: null,
					now: 1,
				});
				ledger.advancePursuit(db, {
					id,
					expectedRevision: 1,
					currentStrategyId: `s-${id}`,
					currentHypothesisId: `h-${id}`,
					now: 1,
				});
				ledger.insertAttempt(db, {
					id: `a-${id}`,
					pursuitId: id,
					hypothesisId: `h-${id}`,
					state: "started",
					tool: "read",
					input: {},
					prediction: { expectedStatus: "ok", expectedObservation: "r" },
					whatChanged: "",
					fingerprint: "legacy",
					rejection: null,
					now: 1,
				});
				db.query(
					"UPDATE pursuit_attempt SET state='settled', outcome='success', observation_json=?, features_json=? WHERE id=?",
				).run(
					JSON.stringify({ status: "ok", output: null, errorCode: null }),
					JSON.stringify({
						filesTouched: [],
						linesChanged: 0,
						protectedTouched: [],
						match: null,
						progress: null,
					}),
					`a-${id}`,
				);
			}
			for (const m of migrations.slice(3)) db.exec(m.sql);
		});
		expect(
			await store.readSnapshot(
				(db) =>
					ledger.loadPursuit(db, "active")!.attempts[0]!.settlement!.stage,
			),
		).toBe("need_post_judge");
		expect(
			await store.readSnapshot(
				(db) =>
					ledger.loadPursuit(db, "finished")!.attempts[0]!.settlement!.stage,
			),
		).toBe("done");
	} finally {
		store.close();
	}
});
