import { APIConnectionError, APIError } from "openai";

export function recoverableResponsesError(error: unknown) {
	if (error instanceof APIConnectionError) return "connection";
	if (!(error instanceof APIError) || error.status === undefined) return null;
	const { status, code } = error;
	if (
		status === 429 &&
		(code === "insufficient_quota" || code === "billing_hard_limit_reached")
	)
		return null;
	return status === 408 || status === 429 || (status >= 500 && status < 600)
		? `http_${status}`
		: null;
}
