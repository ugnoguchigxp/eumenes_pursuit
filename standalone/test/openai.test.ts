import { expect, test } from "bun:test";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { openSettings } from "../settings.ts";
import { createOpenAiLlm } from "../openai.ts";
import { createClaudeLlm } from "../claude.ts";
const request = {
	purpose: "plan" as const,
	system: "fixture",
	prompt: "fixture",
	schema: z.strictObject({ ok: z.boolean() }),
	maxOutputTokens: 20,
};
function setup() {
	const s = openSettings(":memory:");
	s.set("spend.limitUsd", 100);
	s.set("spend.pricing", { m: { input: 1, output: 2 } });
	return s;
}
function response(over: Record<string, unknown> = {}) {
	return {
		id: "resp_fixture",
		object: "response",
		model: "m",
		status: "completed",
		output: [
			{
				type: "message",
				role: "assistant",
				id: "msg_fixture",
				status: "completed",
				content: [
					{ type: "output_text", text: '{"ok":true}', annotations: [] },
				],
			},
		],
		usage: {
			input_tokens: 100,
			input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
			output_tokens: 30,
			output_tokens_details: { reasoning_tokens: 15 },
		},
		...over,
	};
}
for (const purpose of [
	"plan",
	"hypothesize",
	"propose",
	"review",
	"direct",
	"grade",
] as const)
	test(`OpenAI ${purpose}: stateless schema and usage record before parse`, async () => {
		const s = setup();
		try {
			const client = new OpenAI({
				apiKey: "fixture",
				maxRetries: 0,
				fetch: async (_url, init) => {
					const body = JSON.parse(String(init!.body));
					expect(body.store).toBe(false);
					expect(body.previous_response_id).toBeUndefined();
					expect(body.tools).toBeUndefined();
					expect(body.text.format.strict).toBe(true);
					return Response.json(response());
				},
			});
			const r = await createOpenAiLlm(
				{ model: "m", effort: "medium", thinkingHeadroom: 0 },
				s.meter(),
				client,
			).complete({ ...request, purpose }, new AbortController().signal);
			expect(r.value).toEqual({ ok: true });
			expect(s.meter().events()[0]).toMatchObject({
				provider: "openai",
				inputTokens: 70,
				cacheReadTokens: 20,
				cacheWriteTokens: 10,
				outputTokens: 30,
				reasoningTokens: 15,
				status: "ok",
			});
			expect(s.exposureUsd()).toBeCloseTo(0.000145, 6); // 70+2 cached+12.5 cache-write+60 output, rounded up
		} finally {
			s.close();
		}
	});
for (const [name, over] of [
	["incomplete", { status: "incomplete" }],
	[
		"refusal",
		{
			output: [
				{ type: "message", content: [{ type: "refusal", refusal: "fixture" }] },
			],
		},
	],
	["empty", { output: [] }],
	[
		"parse",
		{
			output: [
				{ type: "message", content: [{ type: "output_text", text: "{" }] },
			],
		},
	],
	[
		"schema",
		{
			output: [
				{
					type: "message",
					content: [{ type: "output_text", text: '{"ok":true,"extra":1}' }],
				},
			],
		},
	],
] as const)
	test(`OpenAI rejects ${name} while retaining billed usage`, async () => {
		const s = setup();
		try {
			const client = new OpenAI({
				apiKey: "fixture",
				maxRetries: 0,
				fetch: async () => Response.json(response(over)),
			});
			await expect(
				createOpenAiLlm(
					{ model: "m", effort: "medium", thinkingHeadroom: 0 },
					s.meter(),
					client,
				).complete(request, new AbortController().signal),
			).rejects.toThrow(name);
			expect(s.meter().events()[0]?.status).toBe("invalid");
			expect(s.exposureUsd()).toBeGreaterThan(0);
			expect(s.budgetSnapshot().reservations).toHaveLength(0);
		} finally {
			s.close();
		}
	});
for (const provider of ["claude", "openai"] as const)
	for (const status of [429, 500])
		test(`${provider} HTTP ${status} is not silently retried or treated as free`, async () => {
			const s = setup();
			let calls = 0;
			try {
				const fail = async () => {
					calls++;
					return Response.json(
						{ error: { type: "api_error", message: "fixture" } },
						{ status },
					);
				};
				const role = {
					model: "m",
					effort: "medium" as const,
					thinkingHeadroom: 0,
				};
				const port =
					provider === "openai"
						? createOpenAiLlm(
								role,
								s.meter(),
								new OpenAI({ apiKey: "fixture", maxRetries: 0, fetch: fail }),
							)
						: createClaudeLlm(
								role,
								s.meter(),
								new Anthropic({
									apiKey: "fixture",
									maxRetries: 0,
									fetch: fail,
								}),
							);
				await expect(
					port.complete(request, new AbortController().signal),
				).rejects.toThrow();
				expect(calls).toBe(1);
				expect(s.budgetSnapshot().reservations).toHaveLength(1);
				expect(s.meter().events()[0]?.usd).toBeNull();
			} finally {
				s.close();
			}
		});

for (const [name, phases, error] of [
	[
		"commentary followed by structured final",
		["commentary", "final_answer"],
		null,
	],
	["only commentary is not a result", ["commentary"], "empty"],
	[
		"ambiguous final messages are rejected",
		["final_answer", "final_answer"],
		"multiple_final_messages",
	],
	["unknown phase is not guessed", ["future_phase"], "empty"],
] as const)
	test(`OpenAI phase contract: ${name}`, async () => {
		const s = setup();
		try {
			const client = new OpenAI({
				apiKey: "fixture",
				maxRetries: 0,
				fetch: async () =>
					Response.json(
						response({
							output: phases.map((phase) => ({
								type: "message",
								phase,
								content: [
									{
										type: "output_text",
										text:
											phase === "final_answer"
												? '{"ok":true}'
												: "Working on the request; this is not JSON.",
									},
								],
							})),
						}),
					),
			});
			const result = createOpenAiLlm(
				{ model: "m", effort: "medium", thinkingHeadroom: 0 },
				s.meter(),
				client,
			).complete(request, new AbortController().signal);
			if (error) await expect(result).rejects.toThrow(error);
			else expect((await result).value).toEqual({ ok: true });
			expect(s.exposureUsd()).toBeGreaterThan(0);
			expect(s.budgetSnapshot().reservations).toHaveLength(0);
		} finally {
			s.close();
		}
	});
