import { describe, expect, test } from "bun:test";
import type { JudgeResponse } from "../../../contracts/index.ts";
import { interpret, moreCautious } from "../interpret.ts";
import { pursuitGuardsV1, stageQuestions } from "../question-sets.ts";
import { policy } from "../../../../test/support.ts";

const response = (answers: JudgeResponse["answers"]): JudgeResponse => ({
	answers,
	model: "m",
	adapter: null,
	inputTokens: 1,
	latencyMs: 1,
});

describe("judge interpretation", () => {
	test("every stage fits one d1 request and uses ASCII ids", () => {
		for (const stage of ["pre", "post", "review"] as const)
			for (const lang of ["ja", "en"] as const) {
				const qs = stageQuestions(pursuitGuardsV1, stage, lang);
				expect(Object.keys(qs).length).toBeGreaterThan(0);
				expect(Object.keys(qs).length).toBeLessThanOrEqual(16);
				for (const id of Object.keys(qs)) expect(id).toMatch(/^[a-z_]+$/);
			}
	});
	test("confident acceptance contact rejects and steps back; unsure does nothing", () => {
		const fire = interpret({
			set: pursuitGuardsV1,
			stage: "pre",
			attemptId: null,
			policy,
			response: response({
				touches_acceptance: { type: "noul", pYes: 0.95, confidence: 0.95 },
			}),
		});
		expect(fire.effects.rejections.map((r) => r.rule)).toEqual([
			"judge_touches_acceptance",
		]);
		expect(fire.effects.stepBack).not.toBeNull();
		const unsure = interpret({
			set: pursuitGuardsV1,
			stage: "pre",
			attemptId: null,
			policy,
			response: response({
				touches_acceptance: { type: "noul", pYes: 0.68, confidence: 0.68 },
			}),
		});
		expect(unsure.effects.rejections).toEqual([]);
		expect(unsure.rows[0]?.usable).toBe(false);
	});
	test("scores normalize from 0-based levels", () => {
		const out = interpret({
			set: pursuitGuardsV1,
			stage: "post",
			attemptId: "a",
			policy,
			response: response({
				match: {
					type: "score",
					score: 1,
					confidence: 0.8,
					probabilities: [0.1, 0.8, 0.05, 0.03, 0.02],
				},
				trajectory: {
					type: "choice",
					choice: "thrashing",
					confidence: 0.9,
					probabilities: {},
				},
			}),
		});
		expect(out.effects.match).toBe(0.25);
		expect(out.effects.stepBack).toContain("thrashing");
	});
	test.each(["match", "progress"] as const)(
		"an unconfident %s score is recorded but not used",
		(id) => {
			const out = interpret({
				set: pursuitGuardsV1,
				stage: "post",
				attemptId: "a",
				policy,
				response: response({
					[id]: {
						type: "score",
						score: 1,
						confidence: 0.5,
						probabilities: [0.2, 0.5, 0.2, 0.05, 0.05],
					},
				}),
			});
			expect(out.effects[id]).toBeNull();
			expect(out.rows[0]?.usable).toBe(false);
			expect(out.rows[0]?.answer).toMatchObject({ score: 1, confidence: 0.5 });
		},
	);
	test("progress at the confidence threshold remains usable", () => {
		const out = interpret({
			set: pursuitGuardsV1,
			stage: "post",
			attemptId: "a",
			policy,
			response: response({
				progress: {
					type: "score",
					score: 1,
					confidence: policy.judge.confidence,
					probabilities: [0.2, 0.5, 0.2, 0.05, 0.05],
				},
			}),
		});
		expect(out.effects.progress).toBe(0.25);
		expect(out.rows[0]?.usable).toBe(true);
	});
	test("needs_info asks for consultation", () => {
		const out = interpret({
			set: pursuitGuardsV1,
			stage: "post",
			attemptId: "a",
			policy,
			response: response({
				trajectory: {
					type: "choice",
					choice: "needs_info",
					confidence: 0.8,
					probabilities: {},
				},
			}),
		});
		expect(out.effects.consult).not.toBeNull();
	});
	test("the more cautious decision wins", () => {
		expect(moreCautious("change_hypothesis", "consult")).toBe("consult");
		expect(moreCautious("stop", "continue")).toBe("stop");
	});
});
