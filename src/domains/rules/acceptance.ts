import type { CriterionResult } from "../../contracts/index.ts";

/**
 * Verification passes only when it covers exactly the frozen criteria, once each, in any order,
 * and every one passed. An empty acceptance never passes. Hosts that verify outside the engine
 * (e.g. a direct baseline) use this so their "passed" means the same as the engine's.
 */
export function acceptancePassed(
	acceptance: readonly { readonly id: string }[],
	criteria: readonly CriterionResult[],
): boolean {
	const expected = new Set(acceptance.map((c) => c.id));
	return (
		expected.size > 0 &&
		criteria.length === expected.size &&
		new Set(criteria.map((c) => c.id)).size === expected.size &&
		criteria.every((c) => expected.has(c.id) && c.passed)
	);
}
