/** Additive host integration: durable external work and authorized erasure. */
export const ledgerV7HostLifecycle =
	`
ALTER TABLE pursuit_attempt ADD COLUMN pending_operation_id TEXT;
ALTER TABLE pursuit_attempt ADD COLUMN pending_result_digest TEXT;
ALTER TABLE pursuit_pursuit ADD COLUMN forgotten_at INTEGER;
ALTER TABLE pursuit_operation ADD COLUMN forgotten_at INTEGER;
DROP TRIGGER pursuit_acceptance_frozen_delete;
CREATE TRIGGER pursuit_acceptance_frozen_delete BEFORE DELETE ON pursuit_acceptance
WHEN NOT EXISTS (
 SELECT 1 FROM pursuit_pursuit p WHERE p.id = OLD.pursuit_id AND p.forgotten_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'pursuit_acceptance_frozen'); END;
CREATE TRIGGER pursuit_forgotten_immutable BEFORE UPDATE ON pursuit_pursuit
WHEN OLD.forgotten_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'pursuit_forgotten'); END;
` +
	[
		"pursuit_acceptance",
		"pursuit_strategy",
		"pursuit_hypothesis",
		"pursuit_attempt",
		"pursuit_judgement",
		"pursuit_decision",
		"pursuit_consultation",
		"pursuit_verification",
		"pursuit_inference",
		"pursuit_report",
		"pursuit_finding",
	]
		.map(
			(table) => `
CREATE TRIGGER ${table}_live_insert BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM pursuit_pursuit p WHERE p.id=NEW.pursuit_id AND p.forgotten_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'pursuit_forgotten'); END;
`,
		)
		.join("");
