import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { LlmOutputError, type LlmPort } from "../src/contracts/index.ts";
import type { ClaudeRole } from "./claude.ts";
import type { UsageCall, UsageMeter } from "./usage.ts";

/** Stateless JSON output; tool and OS authority remain with the host's ToolPort. */
export function createOpenAiLlm(
	role: ClaudeRole,
	meter: UsageMeter,
	client = new OpenAI({ maxRetries: 0, timeout: 120_000 }),
): LlmPort {
	return {
		async complete(request, signal) {
			signal.throwIfAborted();
			meter.assertWithinLimit();
			const started = performance.now(),
				callId = crypto.randomUUID();
			const maxTokens = Math.min(
				16000,
				request.maxOutputTokens + role.thinkingHeadroom,
			);
			const call: UsageCall = {
				callId,
				provider: "openai",
				requestedModel: role.model,
				latencyMs: 0,
				status: "response",
			};
			// Schema conversion is local and fallible: do it before reserving or dispatching.
			const format = zodTextFormat(request.schema, "result");
			meter.reserve(call, meter.upperBound(role.model, maxTokens));
			let response: OpenAI.Responses.Response;
			try {
				meter.dispatch(callId);
				response = await client.responses.create(
					{
						model: role.model,
						input: [
							{ role: "system", content: request.system },
							{ role: "user", content: request.prompt },
						],
						reasoning: { effort: role.effort },
						text: { format },
						max_output_tokens: maxTokens,
						store: false,
						service_tier: "default",
					},
					{ signal },
				);
			} catch (error) {
				meter.recordUnknown?.({
					...call,
					status: "error",
					latencyMs: performance.now() - started,
				});
				throw error;
			}
			const usage = response.usage;
			if (!usage) {
				meter.recordUnknown?.({
					...call,
					status: "error",
					latencyMs: performance.now() - started,
				});
				throw new LlmOutputError("usage_missing", response.model);
			}
			const cached = usage.input_tokens_details?.cached_tokens ?? 0;
			const written = usage.input_tokens_details?.cache_write_tokens ?? 0;
			meter.record(
				response.model,
				{
					input_tokens: usage.input_tokens - cached - written,
					cache_read_input_tokens: cached,
					cache_creation_input_tokens: written,
					output_tokens: usage.output_tokens,
					reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
				},
				{
					...call,
					requestId: response.id,
					serviceTier: response.service_tier ?? "default",
					latencyMs: performance.now() - started,
				},
			);
			try {
				if (response.status !== "completed")
					throw new LlmOutputError(
						response.status ?? "status_missing",
						response.model,
					);
				const messages = response.output.filter((r) => r.type === "message");
				if (messages.some((m) => m.content.some((c) => c.type === "refusal")))
					throw new LlmOutputError("refusal", response.model);
				const text = messages
					.flatMap((m) =>
						m.content.flatMap((c) =>
							c.type === "output_text" ? [c.text] : [],
						),
					)
					.join("");
				if (!text) throw new LlmOutputError("empty", response.model);
				let raw: unknown;
				try {
					raw = JSON.parse(text);
				} catch {
					throw new LlmOutputError("parse", response.model);
				}
				const parsed = request.schema.safeParse(raw);
				if (!parsed.success) throw new LlmOutputError("schema", response.model);
				meter.markStatus?.(callId, "ok");
				return {
					value: parsed.data,
					model: response.model,
					inputTokens: usage.input_tokens - cached,
					cacheReadTokens: cached,
					outputTokens: usage.output_tokens,
					latencyMs: performance.now() - started,
				};
			} catch (error) {
				meter.markStatus?.(callId, "invalid");
				throw error;
			}
		},
	};
}
