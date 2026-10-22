import type { UsageCall } from "./usage.ts";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
	LlmOutputError,
	type LlmPort,
	type LlmRequest,
	type LlmResult,
} from "../src/contracts/index.ts";

export interface ClaudeRole {
	/** Model id from settings; never defaulted in code. */
	readonly model: string;
	readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
	/** Room for adaptive thinking on top of the visible answer. */
	readonly thinkingHeadroom: number;
}

export interface UsageMeter {
	record(model: string, usage: Anthropic.Usage, call?: UsageCall): void;
	recordUnknown?(call: UsageCall): void;
	markStatus?(callId: string, status: UsageCall["status"]): void;
	recordExternal?(
		call: UsageCall,
		info: {
			model: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens?: number;
		},
	): void;
	/** Throws before a call when the spend limit would be crossed. */
	assertWithinLimit(): void;
}

/** One stateless structured call per request: every call is a fresh context. */
export function createClaudeLlm(
	role: ClaudeRole,
	meter: UsageMeter,
	client: Anthropic = new Anthropic({ maxRetries: 0 }),
): LlmPort {
	return {
		async complete<T>(
			request: LlmRequest<T>,
			signal: AbortSignal,
		): Promise<LlmResult<T>> {
			meter.assertWithinLimit();
			const started = performance.now();
			// create (not parse) so usage is recorded even when the JSON is cut off or malformed.
			const callId = crypto.randomUUID();
			let response: Anthropic.Message;
			try {
				response = await client.messages.create(
					{
						model: role.model,
						max_tokens: Math.min(
							16000,
							request.maxOutputTokens + role.thinkingHeadroom,
						),
						cache_control: { type: "ephemeral" },
						system: request.system,
						messages: [{ role: "user", content: request.prompt }],
						output_config: {
							effort: role.effort,
							format: zodOutputFormat(request.schema),
						},
					},
					{ signal },
				);
			} catch (error) {
				meter.recordUnknown?.({
					callId,
					requestedModel: role.model,
					latencyMs: performance.now() - started,
					status: "error",
				});
				throw error;
			}
			meter.record(response.model, response.usage, {
				callId,
				requestedModel: role.model,
				latencyMs: performance.now() - started,
				status: "response",
			});
			try {
				if (response.stop_reason === "refusal")
					throw new LlmOutputError("refusal", response.model);
				if (response.stop_reason === "max_tokens")
					throw new LlmOutputError("max_tokens", response.model);
				const text = response.content
					.filter((b): b is Anthropic.TextBlock => b.type === "text")
					.map((b) => b.text)
					.join("");
				let parsed: ReturnType<typeof request.schema.safeParse>;
				try {
					parsed = request.schema.safeParse(JSON.parse(text));
				} catch {
					throw new LlmOutputError("parse", response.model);
				}
				if (!parsed.success) throw new LlmOutputError("schema", response.model);
				meter.markStatus?.(callId, "ok");
				return {
					value: parsed.data,
					model: response.model,
					inputTokens:
						response.usage.input_tokens +
						(response.usage.cache_creation_input_tokens ?? 0),
					outputTokens: response.usage.output_tokens,
					cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
					latencyMs: performance.now() - started,
				};
			} catch (error) {
				meter.markStatus?.(callId, "invalid");
				throw error;
			}
		},
	};
}
