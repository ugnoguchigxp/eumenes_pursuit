/** Append-only: the files or directories a hypothesis declares it will change (spec/fixes-2026-10-22-b.md §1). */
export const ledgerV6HypothesisTargets = `
ALTER TABLE pursuit_hypothesis ADD COLUMN targets_json TEXT NOT NULL DEFAULT '[]';
`;
