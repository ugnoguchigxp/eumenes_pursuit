/** Frozen migration SQL for findings (spec/findings-design.md). Append-only. */
export const ledgerV2Findings = `
CREATE TABLE pursuit_finding (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	seq INTEGER NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('lemma', 'counterexample', 'observation', 'dead_end')),
	statement TEXT NOT NULL,
	assurance TEXT NOT NULL CHECK (assurance IN ('exact', 'numeric', 'model', 'unverified')),
	source_attempt_id TEXT,
	scope TEXT NOT NULL CHECK (scope IN ('pursuit', 'strategy', 'hypothesis')),
	strategy_id TEXT,
	hypothesis_id TEXT,
	status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'refuted')),
	reason TEXT,
	created_at INTEGER NOT NULL,
	closed_at INTEGER,
	UNIQUE (pursuit_id, seq)
) STRICT;
CREATE INDEX pursuit_finding_pursuit ON pursuit_finding(pursuit_id, status);
`;
