/**
 * Direct baseline (condition D0, spec/ablation-design.md): the same task, tools and host-side
 * checks as a pursuit, without the pursuit structure. No plan, hypotheses, predictions,
 * findings, self-check, completion check, step backs or reviewer: the responder sees the goal,
 * the acceptance criteria, the tools and its own history, calls tools freely, and claims
 * completion. A claim runs the task's acceptance (the same verify a pursuit claim runs) and
 * returns 合格/不合格 in the same words as `--claim-feedback verdict`; a failed claim does not
 * end the run. Budgets mirror the pursuit-wide ones of the policy: tool calls (budget.attempts),
 * wall time (budget.wallMs) and responder requests (budget.transitions).
 */
import { z } from "zod";
import { claimLimitReason } from "./claim-oracle.ts";
import {
	acceptancePassed,
	claimVerdictText,
	LlmOutputError,
	type AcceptancePort,
	type CriterionResult,
	type JsonObject,
	type JsonValue,
	type LlmPort,
	observationText,
	type ToolDescriptor,
	type ToolOutcome,
	type ToolPort,
	type WorkspacePort,
} from "../src/index.ts";

export const directStepSchema = z.strictObject({
	kind: z.enum(["tool", "done", "give_up"]),
	tool: z.string().nullable(),
	/** The tool input as a JSON object literal in a string. */
	inputJson: z.string().nullable(),
	/** Raw long text for the tool's text_field (code, reports); null when unused. */
	text: z.string().nullable(),
	message: z.string(),
});
export type DirectStep = z.infer<typeof directStepSchema>;

/** Same budget stop reasons as the pursuit engine, so isForcedStop and isCorrect read both alike. */
export const directStopReasons = {
	toolCalls: "追求全体の試行予算を使い切りました",
	wall: "追求全体の時間予算を使い切りました",
	requests: "追求全体の手順数の上限に達しました",
	invalid: "LLM の出力を受け取れませんでした（直接解法で3回続けて無効な応答）",
	evalCap: "評価の手順数の上限",
	claimLimit: claimLimitReason,
} as const;

export interface DirectBudget {
	/** Executed tool calls (policy budget.attempts). */
	readonly toolCalls: number;
	/** Wall-clock milliseconds from the start (policy budget.wallMs). */
	readonly wallMs: number;
	/** Responder requests (policy budget.transitions, capped by --max-steps). */
	readonly requests: number;
}

export interface DirectEntry {
	readonly n: number;
	readonly kind: "tool" | "invalid" | "claim" | "give_up";
	readonly tool?: string;
	readonly input?: JsonObject;
	readonly status?: "ok" | "error";
	readonly errorCode?: string;
	readonly output?: JsonValue;
	readonly message?: string;
	readonly verdict?: string;
	readonly passed?: boolean;
	readonly at: number;
}

export interface DirectResult {
	readonly outcome: "completed" | "incomplete" | "stopped";
	readonly verified: boolean;
	readonly reason: string;
	readonly criteria: readonly CriterionResult[];
	readonly entries: readonly DirectEntry[];
	readonly toolCalls: number;
	readonly invalidSteps: number;
	readonly claims: number;
	readonly failedClaims: number;
	/** Criteria of each claim, in order (host-side; the generator saw only claimVerdictText). */
	readonly claimCriteria: readonly (readonly CriterionResult[])[];
	readonly requests: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly protectedTouched: readonly string[];
	readonly usage: readonly {
		model: string;
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
	}[];
}

const clip = (text: string, limit: number) =>
	text.length <= limit
		? text
		: `${text.slice(0, limit)}…［表示は全 ${text.length} 字のうち先頭 ${limit} 字。台帳には全文がある］`;
const show = (value: JsonValue | undefined, limit: number) =>
	clip(JSON.stringify(value ?? null), limit);

/** The pursuit executor's rules minus everything structural (strategy, hypothesis, prediction). */
export const directSystem = `You work on a task for a user, using only the tools listed.
Each turn, choose one action: call one tool, claim completion, or give up.
Rules you must respect:
- The acceptance criteria are fixed. Never edit, weaken, delete or work around tests, checks or acceptance conditions. Satisfying a reworded or weaker condition is failure.
- Never claim completion you cannot show. An honest "could not finish" is a good outcome; a faked success is the worst outcome.
- Tools marked permitted:false must not be used.
Write all free text in Japanese.`;

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

/** Observation limits, as the pursuit's policy.observation (spec/fixes-2026-10-22.md §f). */
export interface DirectObservation {
	readonly latestChars: number;
	readonly olderChars: number;
}

/**
 * One history line. Per entry, the same clipping as the pursuit's proposal view (input 600; the
 * latest tool observation up to latestChars, older ones olderChars, with the same notice on how to
 * read the rest); entries older than `full` are one-line summaries.
 */
function entryLine(
	e: DirectEntry,
	full: boolean,
	observed: number,
	tools: readonly ToolDescriptor[],
): string {
	if (e.kind === "claim") return `#${e.n} 完了の申告 → ${e.verdict}`;
	if (e.kind === "invalid") return `#${e.n} 無効な応答: ${e.message}`;
	if (e.kind === "give_up") return `#${e.n} 断念: ${e.message}`;
	const head = `#${e.n} ${e.tool} ${show(e.input, full ? 600 : 160)}`;
	const status = `${e.status}${e.errorCode ? `(${e.errorCode})` : ""}`;
	return full
		? `${head}\n  観測: ${status} ${observationText(
				e.output ?? null,
				observed,
				tools.find((t) => t.name === e.tool),
			)}`
		: `${head} → ${status}`;
}

export function directRequest(input: {
	goal: string;
	acceptance: readonly { id: string; text: string }[];
	tools: readonly ToolDescriptor[];
	grant: readonly string[];
	entries: readonly DirectEntry[];
	budget: DirectBudget;
	toolCalls: number;
	full: number;
	observation?: DirectObservation;
}) {
	const { entries } = input;
	const cut = Math.max(0, entries.length - input.full);
	const limits = input.observation ?? { latestChars: 8000, olderChars: 1800 };
	const latestTool = entries.map((e) => e.kind).lastIndexOf("tool");
	const lastClaim = [...entries].reverse().find((e) => e.kind === "claim");
	return {
		purpose: "direct" as const,
		system: directSystem,
		schema: directStepSchema,
		maxOutputTokens: 10000,
		prompt: [
			["## 目標", input.goal].join("\n"),
			[
				"## 受入条件（変更不可）",
				...input.acceptance.map((a) => `- [${a.id}] ${a.text}`),
			].join("\n"),
			"## 使える道具",
			toolsBlock(input.tools, input.grant),
			entries.length
				? [
						`## これまでの行動（${entries.length} 件。古い ${cut} 件は要約）`,
						...entries.map((e, i) =>
							entryLine(
								e,
								i >= cut,
								i === latestTool ? limits.latestChars : limits.olderChars,
								input.tools,
							),
						),
					].join("\n")
				: "## これまでの行動\nまだありません。",
			lastClaim && !lastClaim.passed
				? "直近の完了の申告は不合格でした。受入条件はまだ満たされていません。"
				: "",
			`## 残り\n道具の呼び出し ${input.toolCalls}/${input.budget.toolCalls} 回を使用。`,
			[
				"## 依頼",
				"次の行動を一つ選んでください。",
				'- kind "tool": 道具を1回使う。tool に道具名、inputJson に入力の JSON オブジェクト（文字列）を書く。道具に text_field があるときは、その欄の長い本文を inputJson に入れず、text に生のまま書く（エスケープ不要）。',
				'- kind "done": 受入条件を満たしたと考える。message に根拠を書く。ホストが照合し、合格なら終わり、不合格ならそのことが返り、続けられる。',
				'- kind "give_up": 達成できないと判断した。message に理由を書く。',
				"使わない項目は null または空文字にしてください。",
			].join("\n"),
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

export async function runDirect(options: {
	readonly goal: string;
	readonly acceptance: readonly { id: string; text: string }[];
	readonly grant: readonly string[];
	readonly tools: ToolPort;
	readonly workspace: WorkspacePort | null;
	readonly acceptancePort: AcceptancePort;
	readonly llm: LlmPort;
	readonly budget: DirectBudget;
	readonly signal: AbortSignal;
	/** Entries shown in full; older ones are summarized (default 40). */
	readonly fullEntries?: number;
	/** Observation limits (default the policy default: latest 8000, older 1800 characters). */
	readonly observation?: DirectObservation;
	readonly now?: () => number;
	/** Called after every entry (transcript persistence). */
	readonly onEntry?: (entry: DirectEntry) => void;
	/** --claim-limit: failed claims after which the run stops (eval/claim-oracle.ts); null = none. */
	readonly claimLimit?: number | null;
}): Promise<DirectResult> {
	const now = options.now ?? (() => Date.now());
	const started = now();
	const tools = options.tools.list();
	const checkpoint = options.workspace
		? await options.workspace.checkpoint()
		: null;
	const entries: DirectEntry[] = [];
	const usage: DirectResult["usage"][number][] = [];
	let toolCalls = 0;
	let invalidSteps = 0;
	let invalidInRow = 0;
	let claims = 0;
	const claimCriteria: CriterionResult[][] = [];
	let failedClaims = 0;
	let requests = 0;
	const push = (e: Omit<DirectEntry, "n" | "at">) => {
		const entry = { ...e, n: entries.length + 1, at: now() } as DirectEntry;
		entries.push(entry);
		options.onEntry?.(entry);
	};
	const end = async (
		outcome: DirectResult["outcome"],
		reason: string,
		known?: readonly CriterionResult[],
	): Promise<DirectResult> => {
		// The final verify and the same strict check as the pursuit's finish() (exactly the frozen
		// criteria, once each, all passed).
		const criteria =
			known ?? (await options.acceptancePort.verify(options.signal));
		const changes =
			options.workspace && checkpoint
				? await options.workspace.changesSince(checkpoint)
				: null;
		return {
			outcome,
			verified: acceptancePassed(options.acceptance, criteria),
			reason,
			criteria,
			entries,
			toolCalls,
			invalidSteps,
			claims,
			failedClaims,
			claimCriteria,
			requests,
			inputTokens: usage.reduce((s, u) => s + u.inputTokens, 0),
			outputTokens: usage.reduce((s, u) => s + u.outputTokens, 0),
			protectedTouched: changes?.protectedTouched ?? [],
			usage,
		};
	};
	for (;;) {
		if (toolCalls >= options.budget.toolCalls)
			return end("stopped", directStopReasons.toolCalls);
		if (now() - started >= options.budget.wallMs)
			return end("stopped", directStopReasons.wall);
		if (requests >= options.budget.requests)
			return end("stopped", directStopReasons.requests);
		requests++;
		let step: DirectStep;
		try {
			const r = await options.llm.complete(
				directRequest({
					goal: options.goal,
					acceptance: options.acceptance,
					tools,
					grant: options.grant,
					entries,
					budget: options.budget,
					toolCalls,
					full: options.fullEntries ?? 40,
					...(options.observation ? { observation: options.observation } : {}),
				}),
				options.signal,
			);
			usage.push({
				model: r.model,
				inputTokens: r.inputTokens,
				outputTokens: r.outputTokens,
				cacheReadTokens: r.cacheReadTokens,
			});
			step = r.value;
		} catch (error) {
			if (!(error instanceof LlmOutputError)) throw error;
			invalidSteps++;
			invalidInRow++;
			push({
				kind: "invalid",
				message: `応答が形式に合いません（${error.reasonCode}）`,
			});
			if (invalidInRow >= 3) return end("stopped", directStopReasons.invalid);
			continue;
		}
		if (step.kind === "give_up") {
			invalidInRow = 0;
			push({ kind: "give_up", message: step.message });
			return end("incomplete", step.message || "達成できないと判断");
		}
		if (step.kind === "done") {
			invalidInRow = 0;
			claims++;
			const criteria = await options.acceptancePort.verify(options.signal);
			const passed = acceptancePassed(options.acceptance, criteria);
			claimCriteria.push([...criteria]);
			push({
				kind: "claim",
				message: step.message,
				passed,
				verdict: claimVerdictText(criteria, passed),
			});
			if (passed)
				return end("completed", step.message || "照合を通過", criteria);
			failedClaims++;
			if (options.claimLimit != null && failedClaims >= options.claimLimit)
				return end("stopped", directStopReasons.claimLimit, criteria);
			continue;
		}
		const name = step.tool ?? "";
		const tool = tools.find((t) => t.name === name);
		let input: JsonObject = {};
		let problem: string | null = null;
		try {
			const parsed: unknown = JSON.parse(step.inputJson ?? "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				input = parsed as JsonObject;
			else problem = "inputJson は JSON オブジェクトにしてください";
		} catch {
			problem = "inputJson が JSON として読めません";
		}
		if (!tool) problem = `道具 ${name || "（空）"} はありません`;
		else if (!options.grant.includes(tool.permission))
			problem = `道具 ${name} は使えません（permitted:false）`;
		if (tool?.textField && step.text !== null && step.text !== undefined)
			input = { ...input, [tool.textField]: step.text };
		if (problem || !tool) {
			invalidSteps++;
			invalidInRow = 0;
			push({ kind: "invalid", tool: name, message: problem ?? "" });
			continue;
		}
		invalidInRow = 0;
		let outcome: ToolOutcome;
		try {
			outcome = await options.tools.invoke(
				{ tool: tool.name, input },
				options.signal,
			);
		} catch (error) {
			if (options.signal.aborted) throw error;
			outcome = {
				status: "error",
				output: { message: "道具の実行中に例外が起きました" },
				errorCode: "tool_exception",
				refs: [],
			};
		}
		toolCalls++;
		push({
			kind: "tool",
			tool: tool.name,
			input,
			status: outcome.status,
			...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
			output: outcome.output,
		});
	}
}

/**
 * `--claim-feedback verdict`, both conditions: when a task ends, the generator is told the latest
 * claim's verdict (a passing claim ends the task, so without this it would never see 合格). The
 * final check after a give-up or a budget stop is not reported (it would tell what a declaration
 * or an unclaimed answer was worth).
 */
export function endNoticeText(
	goal: string,
	lastClaim: {
		passed: boolean;
		criteria: readonly { id: string; passed: boolean; evidence: string }[];
	} | null,
): string {
	const head = goal.replace(/\s+/g, " ").trim().slice(0, 40);
	return [
		`前の課題（目標の冒頭: ${head}…）は終わりました。`,
		lastClaim
			? `最後の完了の申告の照合: ${claimVerdictText(lastClaim.criteria, lastClaim.passed)}`
			: "完了の申告はありませんでした。",
	].join("\n");
}
