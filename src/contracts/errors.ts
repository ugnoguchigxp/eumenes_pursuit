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
