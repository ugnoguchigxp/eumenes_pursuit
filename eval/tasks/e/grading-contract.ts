/** Structural validation only; the model still judges the mathematical content. */
export function idsValid(
	expected: readonly string[],
	actual: readonly string[],
	complete = true,
): boolean {
	const allowed = new Set(expected);
	return (
		allowed.size === expected.length &&
		new Set(actual).size === actual.length &&
		(!complete || actual.length === expected.length) &&
		actual.every((id) => allowed.has(id))
	);
}

export class GradingContractError extends Error {
	readonly code = "grading_response_invalid";
	constructor() {
		super("grading_response_invalid");
	}
}
