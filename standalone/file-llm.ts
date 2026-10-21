import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	LlmOutputError,
	type LlmPort,
	type LlmRequest,
	type LlmResult,
} from "../src/contracts/index.ts";

/**
 * File-based LLM port: an outside responder (a person or another agent) answers.
 * Each call writes <dir>/requests/<role>-<n>.json and waits for <dir>/responses/<role>-<n>.json
 * (the JSON value itself, matching `outputSchema`). Every call is still a fresh context.
 *
 * A response that is not valid JSON or does not match the schema (e.g. an unknown key) is
 * rejected, not fatal: the issues go to responses/<id>.error.txt and the same request is
 * written again as <id>-retry<k>.json with `retryOf` and `previousError`, up to `maxRetries`
 * times (default 2). Only then does the call fail with LlmOutputError.
 */
export function createFileLlm(options: {
	readonly dir: string;
	/** Label for the ledger (`model`) and for request file names. */
	readonly role: string;
	readonly pollMs?: number;
	readonly timeoutMs?: number;
	/** Re-requests after an invalid response before giving up (default 2). */
	readonly maxRetries?: number;
}): LlmPort {
	const requests = join(options.dir, "requests");
	const responses = join(options.dir, "responses");
	mkdirSync(requests, { recursive: true });
	mkdirSync(responses, { recursive: true });
	let counter = 0;
	const model = `file:${options.role}`;
	const maxRetries = options.maxRetries ?? 2;
	return {
		async complete<T>(
			request: LlmRequest<T>,
			signal: AbortSignal,
		): Promise<LlmResult<T>> {
			const base = `${options.role}-${process.pid}-${String(++counter).padStart(4, "0")}`;
			const started = performance.now();
			const body = {
				role: options.role,
				purpose: request.purpose,
				maxOutputTokens: request.maxOutputTokens,
				system: request.system,
				prompt: request.prompt,
				outputSchema: z.toJSONSchema(request.schema, { io: "input" }),
			};
			let previous: { id: string; error: unknown } | null = null;
			for (let attempt = 0; ; attempt++) {
				const id = attempt === 0 ? base : `${base}-retry${attempt}`;
				writeFileSync(
					join(requests, `${id}.json`),
					JSON.stringify(
						{
							id,
							...body,
							...(previous
								? { retryOf: previous.id, previousError: previous.error }
								: {}),
						},
						null,
						2,
					),
				);
				const target = join(responses, `${id}.json`);
				const deadline = Date.now() + (options.timeoutMs ?? 60 * 60_000);
				while (!existsSync(target)) {
					if (signal.aborted) throw new Error("aborted");
					if (Date.now() > deadline) throw new LlmOutputError("timeout", model);
					await Bun.sleep(options.pollMs ?? 1000);
				}
				const text = readFileSync(target, "utf8");
				let reason: "parse" | "schema";
				let error: unknown;
				let json: unknown;
				try {
					json = JSON.parse(text);
				} catch (e) {
					json = undefined;
					error = { message: `invalid JSON: ${String(e)}` };
				}
				if (json !== undefined) {
					const parsed = request.schema.safeParse(json);
					if (parsed.success)
						return {
							value: parsed.data,
							model,
							inputTokens: Math.ceil(
								(request.system.length + request.prompt.length) / 4,
							),
							outputTokens: Math.ceil(text.length / 4),
							cacheReadTokens: 0,
							latencyMs: performance.now() - started,
						};
					reason = "schema";
					error = parsed.error.issues;
				} else reason = "parse";
				writeFileSync(
					join(responses, `${id}.error.txt`),
					JSON.stringify(error, null, 2),
				);
				if (attempt >= maxRetries) throw new LlmOutputError(reason, model);
				previous = { id, error };
			}
		},
	};
}
