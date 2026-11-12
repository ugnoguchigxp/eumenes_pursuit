import { Database } from "bun:sqlite";
import { promotes, type Series } from "./benchmark.ts";

export function digest(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

interface Candidate {
	readonly version: string;
	readonly source: string;
}
interface Measurement {
	readonly id: number;
	readonly version: string;
	readonly control: string;
	readonly state: "running" | "done" | "interrupted";
	readonly result: string | null;
	readonly promoted: number;
}

/** One task driver owns this database. Reopen only after the previous driver has stopped. */
export function openCandidates(
	path: string,
	initialSource: string,
	protocol: string,
	maxMeasurements: number,
) {
	const db = new Database(path, { strict: true });
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;
		CREATE TABLE IF NOT EXISTS candidate(version TEXT PRIMARY KEY, source TEXT NOT NULL, correct INTEGER);
		CREATE TABLE IF NOT EXISTS selection(id INTEGER PRIMARY KEY CHECK (id = 1), protocol TEXT NOT NULL, baseline TEXT NOT NULL, best TEXT NOT NULL REFERENCES candidate(version));
		CREATE TABLE IF NOT EXISTS measurement(id INTEGER PRIMARY KEY, version TEXT NOT NULL REFERENCES candidate(version), control TEXT NOT NULL REFERENCES candidate(version), state TEXT NOT NULL, result TEXT, promoted INTEGER NOT NULL DEFAULT 0);
	`);
	const initial = digest(initialSource);
	const best = () =>
		db
			.query<Candidate, []>(
				"SELECT version, source FROM selection JOIN candidate ON version = best",
			)
			.get()!;
	const checked = (version: string) =>
		db
			.query<{ correct: number | null }, [string]>(
				"SELECT correct FROM candidate WHERE version = ?",
			)
			.get(version)?.correct === 1;
	const eligible = (
		row: Measurement,
		result: readonly Series[],
		noise: Readonly<Record<string, number>>,
	) =>
		best().version === row.control &&
		checked(row.version) &&
		promotes(result, noise);
	try {
		db.transaction(() => {
			const stored = db
				.query<{ protocol: string; baseline: string }, []>(
					"SELECT protocol, baseline FROM selection",
				)
				.get();
			if (
				stored &&
				(stored.protocol !== protocol || stored.baseline !== initial)
			)
				throw new Error("optimizer_protocol_changed");
			if (!stored) {
				db.run("INSERT INTO candidate(version, source) VALUES (?, ?)", [
					initial,
					initialSource,
				]);
				db.run("INSERT INTO selection VALUES (1, ?, ?, ?)", [
					protocol,
					initial,
					initial,
				]);
			}
			db.run(
				"UPDATE measurement SET state = 'interrupted' WHERE state = 'running'",
			);
		}).immediate();
	} catch (error) {
		db.close();
		throw error;
	}
	return {
		initial,
		best,
		markChecked(source: string, correct: boolean) {
			const version = digest(source);
			db.run(
				"INSERT INTO candidate VALUES (?, ?, ?) ON CONFLICT(version) DO UPDATE SET correct=excluded.correct",
				[version, source, Number(correct)],
			);
			return version;
		},
		checked,
		history() {
			return db
				.query<Measurement, []>("SELECT * FROM measurement ORDER BY id")
				.all();
		},
		begin(version: string, retry: boolean) {
			return db
				.transaction(() => {
					const control = best();
					if (!checked(version)) throw new Error("optimizer_unchecked_version");
					if (version === control.version)
						return { kind: "unchanged" as const };
					const old = db
						.query<Measurement, [string, string]>(
							"SELECT * FROM measurement WHERE version = ? AND control = ? ORDER BY id DESC LIMIT 1",
						)
						.get(version, control.version);
					if (old?.state === "done")
						return { kind: "cached" as const, record: old };
					if (old?.state === "interrupted" && !retry)
						return { kind: "interrupted" as const };
					if (
						db.query("SELECT id FROM measurement WHERE state = 'running'").get()
					)
						return { kind: "busy" as const };
					const { total } = db
						.query<{ total: number }, []>(
							"SELECT count(*) AS total FROM measurement",
						)
						.get()!;
					if (total >= maxMeasurements) return { kind: "budget" as const };
					const { lastInsertRowid } = db.run(
						"INSERT INTO measurement(version, control, state) VALUES (?, ?, 'running')",
						[version, control.version],
					);
					return {
						kind: "started" as const,
						id: Number(lastInsertRowid),
						control,
					};
				})
				.immediate();
		},
		finish(
			id: number,
			result: readonly Series[],
			noise: Readonly<Record<string, number>>,
			automatic = true,
		) {
			return db
				.transaction(() => {
					const row = db
						.query<Measurement, [number]>(
							"SELECT * FROM measurement WHERE id = ?",
						)
						.get(id);
					if (row?.state !== "running")
						throw new Error("optimizer_stale_measurement");
					const promoted = automatic && eligible(row, result, noise);
					db.run(
						"UPDATE measurement SET state = 'done', result = ?, promoted = ? WHERE id = ?",
						[JSON.stringify(result), Number(promoted), id],
					);
					if (promoted)
						db.run("UPDATE selection SET best = ? WHERE id = 1", [row.version]);
					return promoted;
				})
				.immediate();
		},
		adopt(
			id: number,
			version: string,
			noise: Readonly<Record<string, number>>,
		) {
			return db
				.transaction(() => {
					const row = db
						.query<Measurement, [number]>(
							"SELECT * FROM measurement WHERE id = ? AND state = 'done'",
						)
						.get(id);
					if (
						!row ||
						row.version !== version ||
						row.result === null ||
						!eligible(row, JSON.parse(row.result) as Series[], noise)
					)
						return false;
					db.run("UPDATE measurement SET promoted = 1 WHERE id = ?", [id]);
					db.run("UPDATE selection SET best = ? WHERE id = 1", [version]);
					return true;
				})
				.immediate();
		},
		interrupt(id: number) {
			db.run(
				"UPDATE measurement SET state = 'interrupted' WHERE id = ? AND state = 'running'",
				[id],
			);
		},
		close: () => db.close(),
	};
}
