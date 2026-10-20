import type {
	JsonObject,
	JsonValue,
	Policy,
	ToolDescriptor,
} from "../../contracts/index.ts";
import type { Signal } from "../rules/checks.ts";
import type {
	AttemptRow,
	HypothesisRow,
	Prediction,
	PursuitView,
} from "../ledger/types.ts";

function clip(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}…(省略)`;
}

function clipJson(value: JsonValue, limit: number): string {
	return clip(JSON.stringify(value), limit);
}

function current(view: PursuitView) {
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	const hypothesis = view.hypotheses.find(
		(h) => h.id === view.currentHypothesisId,
	);
	return { strategy, hypothesis };
}

function recent(
	view: PursuitView,
	hypothesisId: string,
	limit: number,
	n: number,
) {
	return view.attempts
		.filter((a) => a.hypothesisId === hypothesisId && a.state !== "rejected")
		.slice(-n)
		.map((a) => ({
			tool: a.tool,
			input: clipJson(a.input, limit),
			outcome: a.outcome ?? "pending",
			files_touched: a.features?.filesTouched.length ?? 0,
		}));
}

/** Host-computed counts only (plan §8.3); never the generator's self-assessment. */
export function hypothesisFeatures(
	view: PursuitView,
	hypothesisId: string,
	fired: readonly Signal[],
): JsonObject {
	const done = view.attempts.filter(
		(a) => a.hypothesisId === hypothesisId && a.state === "settled",
	);
	const last = done.at(-1)?.features;
	let failures = 0;
	for (const attempt of [...done].reverse()) {
		if (attempt.outcome !== "failure") break;
		failures++;
	}
	const fingerprints = new Map<string, number>();
	for (const a of view.attempts)
		if (a.outcome === "failure")
			fingerprints.set(
				a.fingerprint,
				(fingerprints.get(a.fingerprint) ?? 0) + 1,
			);
	return {
		attempts_in_hypothesis: done.length,
		attempts_total: view.attempts.filter((a) => a.state !== "rejected").length,
		rejected_in_hypothesis: view.attempts.filter(
			(a) => a.hypothesisId === hypothesisId && a.state === "rejected",
		).length,
		consecutive_failures: failures,
		files_touched: last?.filesTouched.length ?? 0,
		lines_changed: last?.linesChanged ?? 0,
		tests_or_checks_touched: last?.protectedTouched.length ?? 0,
		repeated_failure_conditions: [...fingerprints.values()].filter((n) => n > 1)
			.length,
		files_touched_trend: done
			.slice(-6)
			.map((a) => a.features?.filesTouched.length ?? 0),
		match_trend: done
			.slice(-6)
			.map((a) =>
				a.features?.match === null || a.features?.match === undefined
					? null
					: Math.round(a.features.match * 100) / 100,
			),
		signals: fired.map((s) => s.code),
	};
}

/**
 * Halve the text limit until the state fits; if it still does not, keep only the
 * scalar features. d1 rejects (never truncates) inputs over its token limit.
 */
function fit(
	build: (textChars: number) => JsonObject,
	policy: Policy,
): JsonObject {
	const max = policy.judgeState.maxChars;
	let limit = policy.judgeState.textChars;
	let state = build(limit);
	for (let i = 0; i < 4 && JSON.stringify(state).length > max; i++) {
		limit = Math.max(40, Math.floor(limit / 2));
		state = build(limit);
	}
	if (JSON.stringify(state).length <= max) return state;
	const features = (state.features ?? {}) as JsonObject;
	return {
		goal: clip(String(state.goal ?? ""), 120),
		features: Object.fromEntries(
			Object.entries(features).filter(([, v]) => !Array.isArray(v)),
		),
		truncated: true,
	};
}

export function preState(input: {
	view: PursuitView;
	hypothesis: HypothesisRow;
	tool: ToolDescriptor;
	proposal: { input: JsonObject; prediction: Prediction };
	fired: readonly Signal[];
}): JsonObject {
	const { view, hypothesis, tool, proposal } = input;
	const policy = view.input.policy;
	return fit(
		(limit) => ({
			goal: clip(view.goal, limit),
			acceptance: view.acceptance.slice(0, 8).map((a) => clip(a.text, limit)),
			hypothesis: clip(hypothesis.body, limit),
			proposal: {
				tool: tool.name,
				tool_description: clip(tool.description, limit),
				changes_workspace: tool.sideEffect === "workspace",
				input: clipJson(proposal.input, limit * 2),
				prediction: clip(proposal.prediction.expectedObservation, limit),
			},
			recent: recent(view, hypothesis.id, limit, 3),
			features: hypothesisFeatures(view, hypothesis.id, input.fired),
		}),
		policy,
	);
}

export function postState(input: {
	view: PursuitView;
	attempt: AttemptRow;
	fired: readonly Signal[];
}): JsonObject {
	const { view, attempt } = input;
	const policy = view.input.policy;
	const { strategy, hypothesis } = current(view);
	return fit(
		(limit) => ({
			goal: clip(view.goal, limit),
			acceptance: view.acceptance.slice(0, 8).map((a) => clip(a.text, limit)),
			strategy: clip(strategy?.body ?? "", limit),
			hypothesis: clip(hypothesis?.body ?? "", limit),
			attempt: {
				tool: attempt.tool,
				input: clipJson(attempt.input, limit * 2),
				prediction: clip(attempt.prediction.expectedObservation, limit),
				predicted_status: attempt.prediction.expectedStatus,
				observation: clipJson(attempt.observation?.output ?? null, limit * 2),
				status: attempt.observation?.status ?? "error",
			},
			recent: recent(view, attempt.hypothesisId, limit, 4),
			features: hypothesisFeatures(view, attempt.hypothesisId, input.fired),
		}),
		policy,
	);
}

export function reviewState(input: {
	view: PursuitView;
	reason: string;
	fired: readonly Signal[];
}): JsonObject {
	const { view } = input;
	const policy = view.input.policy;
	const { strategy, hypothesis } = current(view);
	return fit(
		(limit) => ({
			goal: clip(view.goal, limit),
			acceptance: view.acceptance.slice(0, 8).map((a) => clip(a.text, limit)),
			step_back_reason: clip(input.reason, limit),
			strategy: clip(strategy?.body ?? "", limit),
			untried_alternatives: (strategy?.alternatives ?? []).map((a) =>
				clip(a, limit),
			),
			hypotheses: view.hypotheses.slice(-4).map((h) => ({
				body: clip(h.body, limit),
				result: clip(h.result ?? "試行中", limit),
				attempts: view.attempts.filter(
					(a) => a.hypothesisId === h.id && a.state !== "rejected",
				).length,
				failures: view.attempts.filter(
					(a) => a.hypothesisId === h.id && a.outcome === "failure",
				).length,
			})),
			strategies_tried: view.strategies.length,
			consultations: view.consultations.slice(-3).map((c) => ({
				question: clip(c.question, limit),
				answer: clip(c.answer ?? "未回答", limit),
			})),
			features: hypothesis
				? hypothesisFeatures(view, hypothesis.id, input.fired)
				: {},
		}),
		policy,
	);
}
