import { Database } from "bun:sqlite";
import type { Scenario } from "./data.ts";
import { rank } from "./ranking.ts";

const { players, stages } = (await Bun.stdin.json()) as Scenario;
const db = new Database(":memory:");
db.exec(`
	CREATE TABLE player (tenant_id TEXT, id TEXT, display_name TEXT, PRIMARY KEY (tenant_id, id));
	CREATE TABLE player_score (tenant_id TEXT, competition_id TEXT, player_id TEXT, score INTEGER, row_num INTEGER);
	CREATE INDEX score_board ON player_score (tenant_id, competition_id, row_num DESC);
`);
const addPlayer = db.query("INSERT INTO player VALUES (?, ?, ?)");
db.transaction(() => {
	for (const player of players) addPlayer.run(...player);
})();
const clear = db.query(
	"DELETE FROM player_score WHERE tenant_id = ? AND competition_id = ?",
);
const addScore = db.query("INSERT INTO player_score VALUES (?, ?, ?, ?, ?)");
const revisions = new Map<string, number>();
const output: string[] = [];
let sqlStatements = 0;
function prepare(sql: string) {
	const statement = db.query(sql);
	return Object.freeze({
		all: (...bindings: Parameters<typeof statement.all>) => {
			sqlStatements++;
			return statement.all(...bindings);
		},
		get: (...bindings: Parameters<typeof statement.get>) => {
			sqlStatements++;
			return statement.get(...bindings);
		},
		values: (...bindings: Parameters<typeof statement.values>) => {
			sqlStatements++;
			return statement.values(...bindings);
		},
		iterate: (...bindings: Parameters<typeof statement.iterate>) => {
			sqlStatements++;
			return statement.iterate(...bindings);
		},
	});
}
const countSql = process.argv.includes("--count-sql");
const connection = countSql
	? (Object.freeze({ query: prepare, prepare }) as unknown as Database)
	: db;
for (const { uploads, requests } of stages) {
	db.exec("PRAGMA query_only = OFF");
	db.transaction(() => {
		for (const [tenant, competition, scores] of uploads) {
			clear.run(tenant, competition);
			for (const [i, [player, score]] of scores.entries())
				addScore.run(tenant, competition, player, score, i + 1);
			const key = JSON.stringify([tenant, competition]);
			revisions.set(key, (revisions.get(key) ?? 0) + 1);
		}
	})();
	db.exec("PRAGMA query_only = ON");
	for (const request of requests) {
		const revision = revisions.get(JSON.stringify(request.slice(0, 2))) ?? 0;
		const page = await rank(connection, ...request, revision);
		output.push(
			JSON.stringify(
				page.map((row) => [
					row.rank,
					row.score,
					row.player_id,
					row.player_display_name,
				]),
			),
		);
	}
}
db.close();
if (countSql) console.log(sqlStatements);
console.log(output.join("\n"));
