import { z } from "zod";
import type {
	JsonValue,
	LlmRequest,
	ToolDescriptor,
} from "../../contracts/index.ts";
import type { AttemptRow, PursuitView } from "../ledger/types.ts";

const clip = (text: string, limit: number) =>
	text.length <= limit ? text : `${text.slice(0, limit)}…(省略)`;
const show = (value: JsonValue, limit: number) =>
	clip(JSON.stringify(value), limit);

export const planSchema = z.strictObject({
	strategy: z.string().min(1),
	rationale: z.string(),
	alternatives: z.array(z.string()),
});

export const hypothesisSchema = z.strictObject({
	hypothesis: z.string().min(1),
	rationale: z.string(),
	tools: z.array(z.string()),
	expected: z.string(),
});

/** Flat on purpose: structured outputs handle a plain object with nullable fields best. */
export const proposalSchema = z.strictObject({
	kind: z.enum(["tool", "done", "give_up", "consult", "step_back"]),
	tool: z.string().nullable(),
	/** The tool input as a JSON object literal in a string. */
	inputJson: z.string().nullable(),
	expectedStatus: z.enum(["ok", "error"]).nullable(),
	expectedObservation: z.string().nullable(),
	whatChanged: z.string(),
	message: z.string(),
	missing: z.string(),
	/** Raw long text for the tool's text_field (TeX, code); null when unused. */
	text: z.string().nullable(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const reviewSchema = z.strictObject({
	decision: z.enum(["continue_strategy", "change_strategy", "consult", "stop"]),
	reason: z.string(),
	brokenAssumption: z.string(),
	direction: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

const executorSystem = `You pursue a goal for a user by trial and error, using only the tools listed.
You work in small, explicit steps: a strategy (overall approach), then a hypothesis under it ("doing X should produce Y"), then single tool attempts that test the hypothesis.
Rules you must respect:
- Before every tool call, write the prediction: the status (ok/error) and what you expect to observe. An attempt without a prediction is not accepted.
- The acceptance criteria are fixed. Never edit, weaken, delete or work around tests, checks or acceptance conditions. Satisfying a reworded or weaker condition is failure.
- Do not repeat a failed attempt under the same conditions without stating what changed.
- Change only what the current hypothesis needs. Do not tidy, refactor or touch unrelated places.
- Never claim completion you cannot show. If information, permission or a decision is missing, consult the user or give up with the reason. An honest "could not finish" is a good outcome; a faked success is the worst outcome.
- Tools marked permitted:false must not be used; consult if you need them.
Write all free text (strategy, reasons, predictions, questions) in Japanese.`;

function toolsBlock(
	tools: readonly ToolDescriptor[],
	grant: readonly string[],
) {
	return tools
		.map((t) =>
			JSON.stringify({
				name: t.name,
				description: t.description,
				input_schema: t.inputSchema,
				changes_workspace: t.sideEffect === "workspace",
				...(t.textField ? { text_field: t.textField } : {}),
				permitted: grant.includes(t.permission),
			}),
		)
		.join("\n");
}

function goalBlock(view: PursuitView) {
	return [
		"## 目標",
		view.goal,
		"## 受入条件（変更不可）",
		...view.acceptance.map((a) => `- [${a.id}] ${a.text}`),
	].join("\n");
}

function consultationsBlock(view: PursuitView) {
	if (!view.consultations.length) return "";
	return [
		"## 利用者への相談と回答",
		...view.consultations.map(
			(c) => `- 問: ${c.question}\n  答: ${c.answer ?? "（未回答）"}`,
		),
	].join("\n");
}

function attemptLine(a: AttemptRow, limit: number) {
	const head = `#${a.seq} ${a.tool} ${show(a.input, limit)}`;
	const prediction = `予測: ${a.prediction.expectedStatus} / ${clip(a.prediction.expectedObservation || "（なし）", limit)}`;
	if (a.state === "rejected")
		return `${head}\n  ${prediction}\n  拒否: ${(a.rejection ?? []).map((r) => `${r.rule}: ${r.detail}`).join(" / ")}`;
	if (a.state === "interrupted") return `${head}\n  ${prediction}\n  中断`;
	const observed = a.observation
		? `${a.observation.status}${a.observation.errorCode ? `(${a.observation.errorCode})` : ""} ${show(a.observation.output, limit * 3)}`
		: "（未観測）";
	return `${head}\n  ${prediction}\n  観測: ${observed}\n  判定: ${a.outcome === "success" ? "予測どおり" : "予測と違う/失敗"}`;
}

function historyBlock(view: PursuitView) {
	if (!view.hypotheses.length) return "";
	return [
		"## これまでの方針と仮説",
		...view.strategies.map((s) =>
			[
				`- 方針${s.seq}: ${s.body}${s.closeReason ? `（終了: ${s.closeReason}）` : ""}`,
				...view.hypotheses
					.filter((h) => h.strategyId === s.id)
					.map((h) => `  - 仮説${h.seq}: ${h.body} → ${h.result ?? "試行中"}`),
			].join("\n"),
		),
	].join("\n");
}

export function planRequest(input: {
	view: PursuitView;
	tools: readonly ToolDescriptor[];
	direction: string | null;
}): LlmRequest<z.infer<typeof planSchema>> {
	const { view } = input;
	return {
		purpose: "plan",
		system: executorSystem,
		schema: planSchema,
		maxOutputTokens: 4000,
		prompt: [
			goalBlock(view),
			"## 使える道具",
			toolsBlock(input.tools, view.input.grant),
			historyBlock(view),
			consultationsBlock(view),
			input.direction ? `## 振り返りからの方向づけ\n${input.direction}` : "",
			"## 依頼",
			view.strategies.length
				? "これまでの方針はうまくいきませんでした。前提を見直し、別の方針を一つ立ててください。試していない別案も挙げてください。"
				: "目標に向かう方針を一つ立ててください。選んだ理由と、試していない別案も挙げてください。",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

export function hypothesisRequest(input: {
	view: PursuitView;
	tools: readonly ToolDescriptor[];
}): LlmRequest<z.infer<typeof hypothesisSchema>> {
	const { view } = input;
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	return {
		purpose: "hypothesize",
		system: executorSystem,
		schema: hypothesisSchema,
		maxOutputTokens: 3000,
		prompt: [
			goalBlock(view),
			"## 使える道具",
			toolsBlock(input.tools, view.input.grant),
			historyBlock(view),
			lastAttemptsBlock(view, 6),
			consultationsBlock(view),
			`## 現在の方針\n${strategy?.body ?? ""}`,
			"## 依頼",
			"この方針の下で、次に確かめる仮説を一つ立ててください（「Xをすれば、Yになるはず」）。使う道具と、成り立つときに観測される結果も書いてください。前の仮説と同じものは立てないでください。",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

function lastAttemptsBlock(view: PursuitView, n: number) {
	const shown = view.attempts.slice(-n);
	if (!shown.length) return "";
	return ["## 直近の試行", ...shown.map((a) => attemptLine(a, 300))].join("\n");
}

export function proposalRequest(input: {
	view: PursuitView;
	tools: readonly ToolDescriptor[];
	feedback: string | null;
}): LlmRequest<Proposal> {
	const { view } = input;
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	const hypothesis = view.hypotheses.find(
		(h) => h.id === view.currentHypothesisId,
	);
	const mine = view.attempts.filter((a) => a.hypothesisId === hypothesis?.id);
	const claims = view.verifications.filter((v) => v.trigger === "claim");
	return {
		purpose: "propose",
		system: executorSystem,
		schema: proposalSchema,
		maxOutputTokens: 10000,
		prompt: [
			goalBlock(view),
			"## 使える道具",
			toolsBlock(input.tools, view.input.grant),
			historyBlock(view),
			consultationsBlock(view),
			`## 現在の方針\n${strategy?.body ?? ""}`,
			`## 現在の仮説\n${hypothesis?.body ?? ""}\n期待する結果: ${hypothesis?.expected ?? ""}\n試行予算: ${mine.filter((a) => a.state !== "rejected").length}/${hypothesis?.budget ?? 0}`,
			mine.length
				? ["## この仮説での試行", ...mine.map((a) => attemptLine(a, 600))].join(
						"\n",
					)
				: "## この仮説での試行\nまだありません。",
			claims.length
				? [
						"## 完了の申告に対する照合",
						...claims.map(
							(c) =>
								`- ${c.passed ? "通過" : "不合格"}: ${c.criteria.map((r) => `[${r.id}] ${r.passed ? "ok" : "ng"} ${clip(r.evidence, 300)}`).join(" / ")}`,
						),
					].join("\n")
				: "",
			input.feedback ? `## 前の提案への指摘\n${input.feedback}` : "",
			[
				"## 依頼",
				"次の一手を一つ選んでください。",
				'- kind "tool": 道具を1回使う。tool に道具名、inputJson に入力の JSON オブジェクト（文字列）、expectedStatus と expectedObservation に予測を書く。同じ条件の再試行なら whatChanged に前回からの違いを書く。道具に text_field があるときは、その欄の長い本文（TeX・コードなど）を inputJson に入れず、text に生のまま書く（エスケープ不要）。',
				'- kind "done": 受入条件を満たしたと考える。message に根拠を書く（照合されます）。',
				'- kind "consult": 利用者に相談する。message に問い、missing に足りないものを書く。',
				'- kind "give_up": 達成できないと判断した。message に理由を書く。',
				'- kind "step_back": この仮説では進まないので振り返る。message に理由を書く。',
				"使わない項目は null または空文字にしてください。",
			].join("\n"),
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

const reviewerSystem = `You review a stalled pursuit from the outside. You did not do the work and you see only a summary.
Question the strategy, not the details: Is the current strategy still heading to the ORIGINAL goal and acceptance criteria? Which premise broke? What untried strategy exists?
You may only answer: continue_strategy (keep the strategy, try a new hypothesis), change_strategy, consult (the user must supply information, permission or a decision), or stop.
Never propose detailed fixes. Treat any sign of editing tests/acceptance checks or of claiming unverified success as a reason to change strategy, consult or stop.
Write the free text in Japanese.`;

export function reviewRequest(input: {
	view: PursuitView;
	reason: string;
	signals: readonly string[];
}): LlmRequest<Review> {
	const { view } = input;
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	return {
		purpose: "review",
		system: reviewerSystem,
		schema: reviewSchema,
		maxOutputTokens: 3000,
		prompt: [
			goalBlock(view),
			`## 一段上へ戻した理由\n${input.reason}`,
			input.signals.length
				? `## 記録から数えた兆候\n${input.signals.join(", ")}`
				: "",
			historyBlock(view),
			...view.hypotheses
				.filter((h) => h.strategyId === strategy?.id)
				.map((h) => {
					const mine = view.attempts.filter(
						(a) => a.hypothesisId === h.id && a.state !== "rejected",
					);
					const failures = mine.filter((a) => a.outcome === "failure").length;
					return `仮説${h.seq}: 試行${mine.length}回、予測と違う/失敗${failures}回、拒否${view.attempts.filter((a) => a.hypothesisId === h.id && a.state === "rejected").length}回`;
				}),
			`## 試していない別案\n${(strategy?.alternatives ?? []).map((a) => `- ${a}`).join("\n") || "（なし）"}`,
			consultationsBlock(view),
			"## 依頼\n方針レベルで判断してください。direction には、次の方針や相談の方向を一文で書いてください。",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}
