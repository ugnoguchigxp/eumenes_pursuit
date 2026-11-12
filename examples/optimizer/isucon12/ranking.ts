import type { Database } from "bun:sqlite";

// Adapted from ISUCON12's initial Node.js ranking handler. See LICENSE.
export function rank(
	db: Database,
	tenantId: string,
	competitionId: string,
	rankAfter: number,
	_revision: number,
) {
	const rows = db
		.query<
			{ player_id: string; score: number; row_num: number },
			[string, string]
		>(
			"SELECT player_id, score, row_num FROM player_score WHERE tenant_id = ? AND competition_id = ? ORDER BY row_num DESC",
		)
		.all(tenantId, competitionId);
	const seen = new Set<string>();
	const ranks = [];
	for (const row of rows) {
		if (seen.has(row.player_id)) continue;
		seen.add(row.player_id);
		const player = db
			.query<{ display_name: string }, [string, string]>(
				"SELECT display_name FROM player WHERE tenant_id = ? AND id = ?",
			)
			.get(tenantId, row.player_id)!;
		ranks.push({ ...row, player_display_name: player.display_name });
	}
	ranks.sort((a, b) => b.score - a.score || a.row_num - b.row_num);
	return ranks.slice(rankAfter, rankAfter + 100).map((entry, i) => ({
		rank: rankAfter + i + 1,
		score: entry.score,
		player_id: entry.player_id,
		player_display_name: entry.player_display_name,
	}));
}
