import { expect, test } from "bun:test";
import { openSettings } from "../settings.ts";
import { totalUsage, type UsageScope } from "../usage.ts";
import { createClaudeLlm } from "../claude.ts";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
const usage = {
	input_tokens: 1000,
	output_tokens: 200,
	cache_read_input_tokens: 100,
	cache_creation_input_tokens: 50,
} as Anthropic.Usage;
const scope = (jobId: string): UsageScope => ({
	runId: "run",
	configId: "cfg",
	jobId,
	pursuitId: "p-" + jobId,
});
function settings() {
	const s = openSettings(":memory:");
	s.set("spend.limitUsd", 100);
	s.set("spend.pricing", { m: { input: 2, output: 10 } });
	return s;
}
test("job and role attribution, idempotence and conservative unknown pricing", () => {
	const s = settings();
	try {
		const a = scope("a");
		const b = scope("b");
		let i = 0;
		for (const role of ["generator", "reviewer", "grader", "critic", "judge"]) {
			const m = s.meter(a, role);
			const call = {
				callId: "call-" + i++,
				requestedModel: "requested",
				status: "response" as const,
				latencyMs: 10,
			};
			m.record("m", usage, call);
			m.record("m", usage, call);
		}
		s.meter(b, "grader").record("m", usage, {
			callId: "b",
			requestedModel: "m",
			status: "ok",
			latencyMs: 1,
		});
		const events = s.meter().events();
		expect(events).toHaveLength(6);
		expect(events[0]!.usd).toBeCloseTo(0.004145, 10);
		expect(totalUsage(s.meter().events("a")).calls).toBe(5);
		expect(Object.keys(totalUsage(s.meter().events("a")).byRole)).toHaveLength(
			5,
		);
		expect(totalUsage(events).usd).toBeCloseTo(
			totalUsage(s.meter().events("a")).usd! +
				totalUsage(s.meter().events("b")).usd!,
			10,
		);
		expect(s.meter().spentUsd()).toBeCloseTo(totalUsage(events).usd!, 10);
		s.meter(a, "generator").record("fallback", usage, {
			callId: "unknown-price",
			requestedModel: "m",
			status: "ok",
			latencyMs: 0,
		});
		expect(totalUsage(s.meter().events("a")).costStatus).toBe("estimated");
	} finally {
		s.close();
	}
});
test("usage unavailable is not zero; external file estimates never invent a bill", () => {
	const s = settings();
	try {
		s.meter(scope("file"), "generator").recordExternal!(
			{
				callId: "file",
				provider: "file",
				requestedModel: "file:g",
				status: "ok",
				latencyMs: 1,
			},
			{ model: "file:g", inputTokens: 20, outputTokens: 10 },
		);
		expect(totalUsage(s.meter().events("file"))).toMatchObject({
			usd: null,
			costStatus: "unknown",
			inputTokens: 20,
		});
		expect(s.meter().spentUsd()).toBe(0);
		s.meter(scope("api"), "grader").recordUnknown!({
			callId: "lost",
			requestedModel: "m",
			status: "error",
			latencyMs: 1,
		});
		expect(totalUsage(s.meter().events("api")).usd).toBeNull();
		expect(() => s.meter().assertWithinLimit()).toThrow("usage_unknown");
	} finally {
		s.close();
	}
});
test("API response usage is recorded before malformed structured output fails", async () => {
	const s = settings();
	try {
		const client = new Anthropic({
			apiKey: "fixture",
			maxRetries: 0,
			fetch: async () =>
				new Response(
					JSON.stringify({
						id: "msg_1",
						type: "message",
						role: "assistant",
						model: "m",
						content: [{ type: "text", text: "not-json" }],
						stop_reason: "end_turn",
						stop_sequence: null,
						usage,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		});
		const port = createClaudeLlm(
			{ model: "requested", effort: "low", thinkingHeadroom: 0 },
			s.meter(scope("a"), "grader"),
			client,
		);
		await expect(
			port.complete(
				{
					purpose: "review",
					system: "s",
					prompt: "p",
					maxOutputTokens: 10,
					schema: z.object({ ok: z.boolean() }),
				},
				new AbortController().signal,
			),
		).rejects.toThrow();
		expect(s.meter().events("a")).toHaveLength(1);
		expect(s.meter().events("a")[0]).toMatchObject({
			status: "invalid",
			requestedModel: "requested",
			servedModel: "m",
			inputTokens: 1000,
			costStatus: "known",
		});
	} finally {
		s.close();
	}
});

test("concurrent API completions stay in their own job scopes", async () => {
	const s = settings();
	try {
		const client = new Anthropic({
			apiKey: "fixture",
			maxRetries: 0,
			fetch: async (_url, init) => {
				const model = JSON.parse(String(init!.body)).model as string;
				await Bun.sleep(model === "slow" ? 10 : 1);
				return new Response(
					JSON.stringify({
						id: "msg_" + model,
						type: "message",
						role: "assistant",
						model: "m",
						content: [{ type: "text", text: '{"ok":true}' }],
						stop_reason: "end_turn",
						stop_sequence: null,
						usage: { ...usage, input_tokens: model === "slow" ? 100 : 200 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		const request = {
			purpose: "plan" as const,
			system: "s",
			prompt: "p",
			schema: z.object({ ok: z.boolean() }),
			maxOutputTokens: 10,
		};
		await Promise.all(
			["slow", "fast"].map((job) =>
				createClaudeLlm(
					{ model: job, effort: "low", thinkingHeadroom: 0 },
					s.meter(scope(job), "generator"),
					client,
				).complete(request, new AbortController().signal),
			),
		);
		expect(s.meter().events("slow")[0]!.inputTokens).toBe(100);
		expect(s.meter().events("fast")[0]!.inputTokens).toBe(200);
		expect(s.meter().events("slow")[0]!.scope!.pursuitId).toBe("p-slow");
	} finally {
		s.close();
	}
});
