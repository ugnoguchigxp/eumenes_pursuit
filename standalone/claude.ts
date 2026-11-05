import type { UsageCall, UsageMeter } from "./usage.ts";
export type { UsageMeter } from "./usage.ts";
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

/** One stateless structured call per request: every call is a fresh context. */
export function createClaudeLlm(
	role: ClaudeRole,
	meter: UsageMeter,
	client: Anthropic = new Anthropic({ maxRetries: 0, timeout: 120_000 }),
): LlmPort {
	return {
		async complete<T>(
			request: LlmRequest<T>,
			signal: AbortSignal,
		): Promise<LlmResult<T>> {
			signal.throwIfAborted();
			meter.assertWithinLimit();
			const started = performance.now();
			// create (not parse) so usage is recorded even when the JSON is cut off or malformed.
			const callId = crypto.randomUUID();
			const maxTokens = Math.min(
				16000,
				request.maxOutputTokens + role.thinkingHeadroom,
			);
			const call: UsageCall = {
				callId,
				provider: "claude",
				requestedModel: role.model,
				latencyMs: 0,
				status: "response",
			};
			const format = zodOutputFormat(request.schema);
			meter.reserve(call, meter.upperBound(role.model, maxTokens));
			let response: Anthropic.Message;
			try {
				meter.dispatch(callId);
				response = await client.messages.create(
					{
						model: role.model,
						max_tokens: maxTokens,
						cache_control: { type: "ephemeral" },
						system: request.system,
						messages: [{ role: "user", content: request.prompt }],
						output_config: {
							effort: role.effort,
							format,
						},
					},
					{ signal },
				);
			} catch (error) {
				meter.recordUnknown?.({
					callId,
					provider: "claude",
					requestedModel: role.model,
					latencyMs: performance.now() - started,
					status: "error",
				});
				throw error;
			}
			if (!response.usage) {
				meter.recordUnknown?.({
					...call,
					status: "error",
					latencyMs: performance.now() - started,
				});
				throw new LlmOutputError("usage_missing", response.model);
			}
			meter.record(response.model, response.usage, {
				callId,
				provider: "claude",
				requestedModel: role.model,
				requestId: response.id,
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
