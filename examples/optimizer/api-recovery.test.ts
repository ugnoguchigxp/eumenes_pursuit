import { expect, test } from "bun:test";
import { APIConnectionError, APIError, APIUserAbortError } from "openai";
import { recoverableResponsesError } from "./api-recovery.ts";

const failure = (status: number, code?: string) =>
	new APIError(status, code ? { code } : undefined, "fixture", new Headers());

test("only transient Responses failures can pause a pursuit", () => {
	expect(recoverableResponsesError(new APIConnectionError({}))).toBe(
		"connection",
	);
	for (const status of [408, 429, 500, 503])
		expect(recoverableResponsesError(failure(status))).toBe(`http_${status}`);
	for (const status of [400, 401, 403, 404])
		expect(recoverableResponsesError(failure(status))).toBeNull();
	expect(
		recoverableResponsesError(failure(429, "insufficient_quota")),
	).toBeNull();
	expect(recoverableResponsesError(new APIUserAbortError())).toBeNull();
	expect(recoverableResponsesError(new Error("503 in text only"))).toBeNull();
});
