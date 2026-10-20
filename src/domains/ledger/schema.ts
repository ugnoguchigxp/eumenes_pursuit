/**
 * Frozen migration SQL. Never edit a published entry; append a new one.
 * The sha256 of each entry is pinned in test/sqlite/migrations.test.ts.
 */
export const ledgerV1 = `
CREATE TABLE pursuit_pursuit (
	id TEXT PRIMARY KEY,
	goal TEXT NOT NULL,
	status TEXT NOT NULL,
	revision INTEGER NOT NULL,
	input_json TEXT NOT NULL,
	current_strategy_id TEXT,
	current_hypothesis_id TEXT,
	started_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	finished_at INTEGER
) STRICT;

CREATE TABLE pursuit_acceptance (
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	criterion_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	text TEXT NOT NULL,
	method TEXT NOT NULL CHECK (method IN ('machine', 'human')),
	frozen_at INTEGER NOT NULL,
	PRIMARY KEY (pursuit_id, criterion_id)
) STRICT;
CREATE TRIGGER pursuit_acceptance_frozen_update BEFORE UPDATE ON pursuit_acceptance
BEGIN SELECT RAISE(ABORT, 'pursuit_acceptance_frozen'); END;
CREATE TRIGGER pursuit_acceptance_frozen_delete BEFORE DELETE ON pursuit_acceptance
BEGIN SELECT RAISE(ABORT, 'pursuit_acceptance_frozen'); END;

CREATE TABLE pursuit_strategy (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	seq INTEGER NOT NULL,
	body TEXT NOT NULL,
	rationale TEXT NOT NULL,
	alternatives_json TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
	close_reason TEXT,
	previous_id TEXT,
	created_at INTEGER NOT NULL,
	closed_at INTEGER,
	UNIQUE (pursuit_id, seq)
) STRICT;

CREATE TABLE pursuit_hypothesis (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	strategy_id TEXT NOT NULL REFERENCES pursuit_strategy(id),
	seq INTEGER NOT NULL,
	body TEXT NOT NULL,
	rationale TEXT NOT NULL,
	tools_json TEXT NOT NULL,
	expected TEXT NOT NULL,
	budget INTEGER NOT NULL,
	checkpoint TEXT,
	status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
	result TEXT,
	created_at INTEGER NOT NULL,
	closed_at INTEGER,
	UNIQUE (pursuit_id, seq)
) STRICT;

CREATE TABLE pursuit_attempt (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	hypothesis_id TEXT NOT NULL REFERENCES pursuit_hypothesis(id),
	seq INTEGER NOT NULL,
	state TEXT NOT NULL CHECK (state IN ('rejected', 'started', 'settled', 'interrupted')),
	tool TEXT NOT NULL,
	input_json TEXT NOT NULL,
	prediction_json TEXT NOT NULL,
	what_changed TEXT NOT NULL,
	fingerprint TEXT NOT NULL,
	rejection_json TEXT,
	observation_json TEXT,
	outcome TEXT CHECK (outcome IN ('success', 'failure')),
	refs_json TEXT NOT NULL,
	features_json TEXT,
	started_at INTEGER NOT NULL,
	settled_at INTEGER,
	UNIQUE (pursuit_id, seq)
) STRICT;
CREATE INDEX pursuit_attempt_hypothesis ON pursuit_attempt(hypothesis_id, seq);

CREATE TABLE pursuit_judgement (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	attempt_id TEXT,
	stage TEXT NOT NULL CHECK (stage IN ('pre', 'post', 'review')),
	question_set_id TEXT NOT NULL,
	question_set_version INTEGER NOT NULL,
	question_id TEXT NOT NULL,
	answer_json TEXT NOT NULL,
	threshold REAL NOT NULL,
	fired INTEGER NOT NULL CHECK (fired IN (0, 1)),
	usable INTEGER NOT NULL CHECK (usable IN (0, 1)),
	model TEXT NOT NULL,
	adapter_json TEXT,
	created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pursuit_judgement_pursuit ON pursuit_judgement(pursuit_id, created_at);

CREATE TABLE pursuit_decision (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	seq INTEGER NOT NULL,
	kind TEXT NOT NULL,
	reason TEXT NOT NULL,
	basis_json TEXT NOT NULL,
	decided_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE (pursuit_id, seq)
) STRICT;

CREATE TABLE pursuit_consultation (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	question TEXT NOT NULL,
	missing TEXT NOT NULL,
	options_json TEXT NOT NULL,
	answer TEXT,
	asked_at INTEGER NOT NULL,
	answered_at INTEGER
) STRICT;

CREATE TABLE pursuit_verification (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	attempt_id TEXT,
	trigger TEXT NOT NULL CHECK (trigger IN ('attempt', 'claim', 'final')),
	passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
	criteria_json TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE pursuit_inference (
	id TEXT PRIMARY KEY,
	pursuit_id TEXT NOT NULL REFERENCES pursuit_pursuit(id),
	purpose TEXT NOT NULL,
	model TEXT NOT NULL,
	input_tokens INTEGER NOT NULL,
	output_tokens INTEGER NOT NULL,
	cache_read_tokens INTEGER NOT NULL,
	latency_ms INTEGER NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE pursuit_report (
	pursuit_id TEXT PRIMARY KEY REFERENCES pursuit_pursuit(id),
	report_json TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE pursuit_operation (
	operation_key TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	digest TEXT NOT NULL,
	pursuit_id TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;
`;
