import type { CriterionResult } from "./ports.ts";

/** The model answered, but not in the requested shape (refusal, truncation, invalid JSON). */
export class LlmOutputError extends Error {
	constructor(
		readonly reasonCode: string,
		readonly model: string,
	) {
		super(`llm_output:${reasonCode}`);
		this.name = "LlmOutputError";
	}
}

/** A verifier failed after collecting some observations. These cannot establish completion. */
export class AcceptanceVerificationError extends Error {
	constructor(
		readonly criteria: readonly CriterionResult[],
		options?: ErrorOptions,
	) {
		super("acceptance_verification_failed", options);
		this.name = "AcceptanceVerificationError";
	}
}
