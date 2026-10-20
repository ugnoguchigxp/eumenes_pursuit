import { describe, expect, test } from "bun:test";
import type { JudgeRequest } from "../../../src/contracts/judge.ts";
import { smokeQuestions } from "../fixtures.ts";
import {
	buildInferBody,
	checkStateSize,
	createDecisionJudge,
	LarmDecisionError,
	parseInferResponse,
} from "../judge.ts";

/** Shape taken from the real production response (values rounded). */
const realResponse = {
	model: "d1-3b-general",
	adapter: null,
	answers: {
		scope_expanding: { type: "noul", noul: 0.2689, confidence: 0.7311 },
		touches_checks: { type: "noul", noul: 0.1009, confidence: 0.8991 },
		flow: {
			type: "choice",
			choice: "stalled",
			confidence: 0.8388,
			probabilities: { progressing: 0.1286, stalled: 0.8388, runaway: 0.0325 },
		},
		closeness: {
			type: "score",
			score: 0.2575,
			confidence: 0.8479,
			probabilities: { "0": 0.8479, "1": 0.084, "2": 0.0309, "3": 0.0373 },
			legend: ["a", "b", "c", "d"],
		},
	},
	usage: { input_tokens: 283 },
	routing: { inference_ms: 12 },
};

const request: JudgeRequest = {
	state: { goal: "ログイン画面のテストを通す" },
	questions: smokeQuestions,
	questionSet: { id: "smoke", version: 1 },
	adapter: null,
};

function catching(fn: () => unknown): LarmDecisionError {
	try {
		fn();
	} catch (error) {
		if (error instanceof LarmDecisionError) return error;
		throw error;
	}
	throw new Error("did not throw");
}

describe("parseInferResponse", () => {
	test("maps noul / choice / score and tokens", () => {
		const mapped = parseInferResponse(realResponse, request, "d1-3b-general");
		expect(mapped.inputTokens).toBe(283);
		expect(mapped.adapter).toBeNull();
		expect(mapped.answers.scope_expanding).toEqual({
			type: "noul",
			pYes: 0.2689,
			confidence: 0.7311,
		});
		expect(mapped.answers.flow).toMatchObject({
			type: "choice",
			choice: "stalled",
		});
		expect(mapped.answers.closeness).toEqual({
			type: "score",
			score: 0.2575,
			confidence: 0.8479,
			probabilities: [0.8479, 0.084, 0.0309, 0.0373],
		});
	});

	test("orders score probabilities by numeric index (10 levels)", () => {
		const criteria = Array.from({ length: 10 }, (_, i) => `level ${i}`);
		const probabilities = Object.fromEntries(
			criteria.map((_, i) => [String(i), i / 100]),
		);
		const req: JudgeRequest = {
			...request,
			questions: { s: { type: "score", instructions: "x", criteria } },
		};
		const mapped = parseInferResponse(
			{
				...realResponse,
				answers: {
					s: { type: "score", score: 3, confidence: 0.5, probabilities },
				},
			},
			req,
			"d1-3b-general",
		);
		const answer = mapped.answers.s;
		expect(answer?.type === "score" && answer.probabilities).toEqual(
			criteria.map((_, i) => i / 100),
		);
	});

	test("rejects a different model", () => {
		expect(
			catching(() => parseInferResponse(realResponse, request, "other")).code,
		).toBe("larm_model_mismatch");
	});

	test("rejects an adapter that was not requested, and a missing requested one", () => {
		const withAdapter = { ...realResponse, adapter: { id: "a", version: 1 } };
		expect(
			catching(() => parseInferResponse(withAdapter, request, "d1-3b-general"))
				.code,
		).toBe("larm_adapter_mismatch");
		const requested = { ...request, adapter: { id: "a", version: 2 } };
		expect(
			catching(() =>
				parseInferResponse(withAdapter, requested, "d1-3b-general"),
			).code,
		).toBe("larm_adapter_mismatch");
		expect(
			parseInferResponse(
				withAdapter,
				{ ...request, adapter: { id: "a", version: 1 } },
				"d1-3b-general",
			).adapter,
		).toEqual({
			id: "a",
			version: 1,
		});
	});

	test("rejects wrong shapes", () => {
		const bad = (body: unknown) =>
			catching(() => parseInferResponse(body, request, "d1-3b-general")).code;
		expect(bad({})).toBe("larm_invalid_response");
		expect(bad({ ...realResponse, usage: {} })).toBe("larm_invalid_response");
		expect(
			bad({
				...realResponse,
				answers: { ...realResponse.answers, flow: undefined },
			}),
		).toBe("larm_invalid_response");
		expect(
			bad({
				...realResponse,
				answers: {
					...realResponse.answers,
					scope_expanding: { type: "noul", noul: 1.5, confidence: 0.5 },
				},
			}),
		).toBe("larm_invalid_response");
		// answer type differs from the question type
		expect(
			bad({
				...realResponse,
				answers: {
					...realResponse.answers,
					scope_expanding: realResponse.answers.closeness,
				},
			}),
		).toBe("larm_invalid_response");
		// choice outside the criteria
		expect(
			bad({
				...realResponse,
				answers: {
					...realResponse.answers,
					flow: {
						type: "choice",
						choice: "other",
						confidence: 0.5,
						probabilities: { other: 1 },
					},
				},
			}),
		).toBe("larm_invalid_response");
		// score probabilities with a gap
		expect(
			bad({
				...realResponse,
				answers: {
					...realResponse.answers,
					closeness: {
						type: "score",
						score: 1,
						confidence: 0.5,
						probabilities: { "0": 0.5, "1": 0.2, "2": 0.2, "4": 0.1 },
					},
				},
			}),
		).toBe("larm_invalid_response");
	});
});

describe("limits", () => {
	test("state over 50,000 UTF-8 bytes is rejected locally", () => {
		// 3 bytes per character in UTF-8
		const big = { text: "あ".repeat(16_700) };
		const error = catching(() => checkStateSize(big));
		expect(error.code).toBe("decision_state_limit");
		expect(error.httpStatus).toBe(413);
		expect(() => checkStateSize({ text: "あ".repeat(16_000) })).not.toThrow();
	});

	test("ask checks question count and state before touching the network", async () => {
		let calls = 0;
		const judge = createDecisionJudge(
			{
				withProvider: async (fn) => {
					calls++;
					return fn({
						endpoint: "http://x/v1/systemone",
						model: "m",
						token: "t",
					});
				},
			},
			{ fetch: async () => new Response("{}") },
		);
		const signal = new AbortController().signal;
		await expect(
			judge.ask({ ...request, questions: {} }, signal),
		).rejects.toMatchObject({
			code: "decision_question_limit",
		});
		const many = Object.fromEntries(
			Array.from({ length: 17 }, (_, i) => [
				`q${i}`,
				smokeQuestions.touches_checks!,
			]),
		);
		await expect(
			judge.ask({ ...request, questions: many }, signal),
		).rejects.toMatchObject({
			code: "decision_question_limit",
		});
		await expect(
			judge.ask({ ...request, state: { t: "あ".repeat(20_000) } }, signal),
		).rejects.toMatchObject({ code: "decision_state_limit" });
		expect(calls).toBe(0);
	});
});

describe("ask over HTTP", () => {
	const provider = {
		endpoint: "http://larm.test:9810/v1/systemone",
		model: "d1-3b-general",
		token: "secret",
	};
	const source = {
		withProvider: <T>(fn: (p: typeof provider) => Promise<T>) => fn(provider),
	};

	test("sends bearer + body and measures latency", async () => {
		let seen: { auth: string | null; body: unknown } | undefined;
		const judge = createDecisionJudge(source, {
			fetch: async (_input, init) => {
				seen = {
					auth: new Headers(init?.headers).get("authorization"),
					body: JSON.parse(String(init?.body)),
				};
				return Response.json(realResponse);
			},
		});
		const response = await judge.ask(request, new AbortController().signal);
		expect(seen?.auth).toBe("Bearer secret");
		expect(seen?.body).toEqual(buildInferBody("d1-3b-general", request));
		expect(seen?.body).not.toHaveProperty("adapter");
		expect(response.latencyMs).toBeGreaterThanOrEqual(0);
		expect(response.inputTokens).toBe(283);
	});

	test("maps server error bodies to LarmDecisionError", async () => {
		const judge = createDecisionJudge(source, {
			fetch: async () =>
				Response.json(
					{
						error: {
							code: "decision_adapter_not_found",
							message: "no such adapter",
						},
					},
					{ status: 404 },
				),
		});
		const error = await judge
			.ask(request, new AbortController().signal)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LarmDecisionError);
		expect(error).toMatchObject({
			code: "decision_adapter_not_found",
			httpStatus: 404,
		});
	});

	test("non-JSON error body keeps the HTTP status", async () => {
		const judge = createDecisionJudge(source, {
			fetch: async () => new Response("nope", { status: 401 }),
		});
		await expect(
			judge.ask(request, new AbortController().signal),
		).rejects.toMatchObject({
			code: "larm_http_401",
			httpStatus: 401,
		});
	});
});
