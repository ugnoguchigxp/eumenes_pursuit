/** Append-only recovery state for a tool result whose checks are unfinished. */
export const ledgerV4Settlement = `
ALTER TABLE pursuit_attempt ADD COLUMN settlement_json TEXT NOT NULL DEFAULT '{"stage":"done","digest":null,"effects":null}';
UPDATE pursuit_attempt SET settlement_json = '{"stage":"need_post_judge","digest":null,"effects":null}'
WHERE state = 'settled' AND id IN (
 SELECT a.id FROM pursuit_attempt a JOIN pursuit_pursuit p ON p.id = a.pursuit_id
 WHERE p.status = 'proposing' AND a.hypothesis_id = p.current_hypothesis_id
 AND a.seq = (SELECT MAX(b.seq) FROM pursuit_attempt b WHERE b.pursuit_id = p.id)
);
`;
