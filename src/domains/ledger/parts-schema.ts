/** Frozen migration SQL for strategy parts and self-assessment (spec/persistence-design.md). Append-only. */
export const ledgerV3Parts = `
ALTER TABLE pursuit_strategy ADD COLUMN parts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pursuit_strategy ADD COLUMN assessment_json TEXT;
`;
