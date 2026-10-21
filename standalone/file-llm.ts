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
 */
export function createFileLlm(options: {
	readonly dir: string;
	/** Label for the ledger (`model`) and for request file names. */
	readonly role: string;
	readonly pollMs?: number;
	readonly timeoutMs?: number;
}): LlmPort {
	const requests = join(options.dir, "requests");
	const responses = join(options.dir, "responses");
	mkdirSync(requests, { recursive: true });
	mkdirSync(responses, { recursive: true });
	let counter = 0;
	const model = `file:${options.role}`;
	return {
		async complete<T>(
			request: LlmRequest<T>,
			signal: AbortSignal,
		): Promise<LlmResult<T>> {
			const id = `${options.role}-${process.pid}-${String(++counter).padStart(4, "0")}`;
			const started = performance.now();
			writeFileSync(
				join(requests, `${id}.json`),
				JSON.stringify(
					{
						id,
						role: options.role,
						purpose: request.purpose,
						maxOutputTokens: request.maxOutputTokens,
						system: request.system,
						prompt: request.prompt,
						outputSchema: z.toJSONSchema(request.schema, { io: "input" }),
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
			let parsed: ReturnType<typeof request.schema.safeParse>;
			try {
				parsed = request.schema.safeParse(JSON.parse(text));
			} catch {
				throw new LlmOutputError("parse", model);
			}
			if (!parsed.success) {
				writeFileSync(
					join(responses, `${id}.error.txt`),
					JSON.stringify(parsed.error.issues, null, 2),
				);
				throw new LlmOutputError("schema", model);
			}
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
		},
	};
}
