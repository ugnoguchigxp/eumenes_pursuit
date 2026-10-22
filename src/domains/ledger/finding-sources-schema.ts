/** Append-only provenance for independently verified findings. */
export const ledgerV5FindingSources = `
ALTER TABLE pursuit_finding ADD COLUMN source_verification_id TEXT REFERENCES pursuit_verification(id);
`;
