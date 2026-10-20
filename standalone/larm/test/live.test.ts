import { afterAll, describe, expect, test } from "bun:test";
import type { JudgeRequest } from "../../../src/contracts/judge.ts";
import { type DecisionLease, openDecisionLease } from "../connection.ts";
import { smokeQuestions } from "../fixtures.ts";
import { LarmDecisionError } from "../judge.ts";

/** Live LARM test: allocate, infer, adapter-not-found, release. Skipped unless PURSUIT_LIVE=1. */
const live = process.env.PURSUIT_LIVE === "1";

describe.skipIf(!live)("live d1", () => {
	const env = (name: string) => {
		const value = process.env[name];
		if (!value) throw new Error(`missing env var ${name}`);
		return value;
	};
	const lease: DecisionLease = live
		? openDecisionLease({
				origin: env("PURSUIT_LARM_ORIGIN"),
				token: env("LARM_API_TOKEN"),
				selector: env("PURSUIT_LARM_PROFILE"),
				audience: env("PURSUIT_LARM_AUDIENCE"),
				clientId: env("PURSUIT_LARM_CLIENT"),
				catalogCapability: "decision.general",
			})
		: (undefined as never);

	afterAll(async () => {
		await lease.release();
	});

	const request: JudgeRequest = {
		state: {
			goal: "ログイン画面のテストを通す",
			attempts: 4,
			failing_tests: [6, 6, 5, 5],
		},
		questions: smokeQuestions,
		questionSet: { id: "live-smoke", version: 1 },
		adapter: null,
	};

	test("infers noul / choice / score in one request", async () => {
		const response = await lease.judge.ask(
			request,
			AbortSignal.timeout(120_000),
		);
		expect(response.adapter).toBeNull();
		expect(response.inputTokens).toBeGreaterThan(0);
		expect(response.latencyMs).toBeGreaterThan(0);
		const a = response.answers;
		expect(a.scope_expanding?.type).toBe("noul");
		expect(a.flow?.type).toBe("choice");
		const score = a.closeness;
		expect(score?.type === "score" && score.probabilities.length).toBe(4);
		// the lease is reused for a second request
		const second = await lease.judge.ask(request, AbortSignal.timeout(60_000));
		expect(second.model).toBe(response.model);
	}, 180_000);

	test("unknown adapter is rejected with decision_adapter_not_found", async () => {
		const error = await lease.judge
			.ask(
				{ ...request, adapter: { id: "does-not-exist", version: 1 } },
				AbortSignal.timeout(60_000),
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LarmDecisionError);
		expect(error).toMatchObject({
			code: "decision_adapter_not_found",
			httpStatus: 404,
		});
	}, 90_000);
});
