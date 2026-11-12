import type { Database } from "bun:sqlite";

type Entry = {
	rank: number;
	score: number;
	player_id: string;
	player_display_name: string;
};
const cache = new WeakMap<
	Database,
	Map<string, { revision: number; rows: Entry[] }>
>();

export function rank(
	db: Database,
	tenantId: string,
	competitionId: string,
	rankAfter: number,
	revision: number,
) {
	let boards = cache.get(db);
	if (!boards) cache.set(db, (boards = new Map()));
	const key = JSON.stringify([tenantId, competitionId]);
	let board = boards.get(key);
	if (!board || board.revision !== revision) {
		const rows = db
			.query<Entry, [string, string]>(`
			WITH uploads AS (
				SELECT tenant_id, player_id, score, row_num,
				       ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY row_num DESC) AS latest
				FROM player_score WHERE tenant_id = ? AND competition_id = ?
			)
			SELECT ROW_NUMBER() OVER (ORDER BY score DESC, row_num) AS rank,
			       score, player_id, p.display_name AS player_display_name
			FROM uploads JOIN player AS p ON p.tenant_id = uploads.tenant_id AND p.id = uploads.player_id
			WHERE latest = 1 ORDER BY rank
		`)
			.all(tenantId, competitionId);
		board = { revision, rows };
		boards.set(key, board);
	}
	return board.rows.slice(rankAfter, rankAfter + 100);
}
