import { findingClaimKey } from "../ledger/findings.ts";
import { z } from "zod";
import type {
	JsonValue,
	LlmRequest,
	ToolDescriptor,
} from "../../contracts/index.ts";
import type { AttemptRow, PursuitView } from "../ledger/types.ts";

const clip = (text: string, limit: number) =>
	text.length <= limit
		? text
		: `${text.slice(0, limit)}…［この一覧での表示はここまで。実物は省略されていない］`;
const show = (value: JsonValue, limit: number) =>
	clip(JSON.stringify(value), limit);

export const planSchema = z.strictObject({
	strategy: z.string().min(1),
	rationale: z.string(),
	alternatives: z.array(z.string()),
});

/** With selfCheck "parts", a strategy also lists the parts it needs. */
export const planWithPartsSchema = planSchema.extend({
	parts: z.array(z.string().min(1)).min(1).max(6),
});
export type Plan = z.infer<typeof planSchema> & { parts?: string[] };

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
const declaredFinding = z.strictObject({
	kind: z.enum(["lemma", "counterexample", "observation"]),
	statement: z.string().min(1),
	scope: z.enum(["pursuit", "strategy", "hypothesis"]),
});

/** With findings on, a proposal may also declare, refute and cite findings. */
export const proposalWithFindingsSchema = proposalSchema.extend({
	findings: z.array(declaredFinding).max(3),
	refute: z
		.array(z.strictObject({ id: z.string(), reason: z.string() }))
		.max(3),
	uses: z.array(z.string()).max(10),
});
const partAssessment = z.strictObject({
	part: z.int().min(1),
	status: z.enum(["done", "blocked", "untried"]),
	evidence: z.string(),
	next: z.string(),
});
const assessmentField = { assessment: z.array(partAssessment).max(6) };
const refutationField = { refutedIf: z.string().nullable() };
const acceptanceCheck = z.strictObject({
	id: z.string(),
	met: z.boolean(),
	where: z.string(),
});
const acceptanceCheckField = {
	acceptanceCheck: z.array(acceptanceCheck).max(20),
};

export type Proposal = z.infer<typeof proposalSchema> &
	Partial<
		Pick<
			z.infer<typeof proposalWithFindingsSchema>,
			"findings" | "refute" | "uses"
		>
	> & {
		assessment?: z.infer<typeof partAssessment>[];
		refutedIf?: string | null;
		acceptanceCheck?: z.infer<typeof acceptanceCheck>[];
	};

/** The proposal fields depend on the conditions, so "off" stays the baseline. */
function proposalSchemaFor(
	conditions: PursuitView["input"]["conditions"],
): z.ZodType<Proposal> {
	const base =
		conditions.findings === "off" ? proposalSchema : proposalWithFindingsSchema;
	return base.extend({
		...(conditions.selfCheck === "parts" ? assessmentField : {}),
		...(conditions.prediction === "falsifiable" ? refutationField : {}),
		...(conditions.completionCheck === "acceptance"
			? acceptanceCheckField
			: {}),
	}) as z.ZodType<Proposal>;
}

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
- Do not repeat a failed or interrupted (outcome unknown) attempt under the same conditions without stating what changed.
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
	const prediction = `予測: ${a.prediction.expectedStatus} / ${clip(a.prediction.expectedObservation || "（なし）", limit)}${a.prediction.refutedIf ? `\n  反証の条件: ${clip(a.prediction.refutedIf, limit)}` : ""}`;
	if (a.state === "rejected")
		return `${head}\n  ${prediction}\n  拒否: ${(a.rejection ?? []).map((r) => `${r.rule}: ${r.detail}`).join(" / ")}`;
	if (a.state === "interrupted")
		return `${head}\n  ${prediction}\n  中断（実行結果・副作用の有無は不明）`;
	const observed = a.observation
		? `${a.observation.status}${a.observation.errorCode ? `(${a.observation.errorCode})` : ""} ${show(a.observation.output, limit * 3)}`
		: "（未観測）";
	return `${head}\n  ${prediction}\n  観測: ${observed}\n  判定: ${a.outcome === "success" ? "予測どおり" : "予測と違う/失敗"}`;
}

const assuranceLabel = {
	exact: "確定",
	numeric: "数値で確認",
	model: "採点で確認",
	unverified: "未確認",
} as const;
const scopeLabel = (view: PursuitView, f: PursuitView["findings"][number]) => {
	if (f.scope === "pursuit") return "前提なし";
	if (f.scope === "strategy")
		return `方針${view.strategies.find((s) => s.id === f.strategyId)?.seq ?? "?"}`;
	return `仮説${view.hypotheses.find((h) => h.id === f.hypothesisId)?.seq ?? "?"}`;
};

/** Findings kept apart from hypotheses (spec/findings-design.md). Empty when off. */
function findingsBlock(view: PursuitView, forProposal: boolean) {
	const mode = view.input.conditions.findings;
	if (mode === "off") return "";
	const order = { exact: 0, numeric: 1, model: 2, unverified: 3 } as const;
	const shown = view.findings.filter(
		(f) =>
			f.status === "active" &&
			f.kind !== "dead_end" &&
			(mode === "all" || f.assurance !== "unverified"),
	);
	shown.sort(
		(a, b) => order[a.assurance] - order[b.assurance] || b.seq - a.seq,
	);
	const groups = new Map<string, typeof shown>();
	for (const f of shown) {
		const key = findingClaimKey(f);
		const rows = groups.get(key) ?? [];
		rows.push(f);
		groups.set(key, rows);
	}
	const deadEnds = view.findings.filter((f) => f.kind === "dead_end");
	const superseded = view.findings
		.filter((f) => f.status === "superseded" && f.kind !== "dead_end")
		.slice(-5);
	const line = (f: PursuitView["findings"][number]) =>
		`- F${f.seq} [${f.kind}・${assuranceLabel[f.assurance]}・${scopeLabel(view, f)}] ${clip(f.statement, 400)}${f.sourceAttemptId || f.sourceVerificationId ? ` (出典: ${f.sourceAttemptId ?? f.sourceVerificationId})` : ""}`;
	return [
		"## 知見（仮説を変えても残る）",
		shown.length
			? [...groups.values()]
					.slice(0, 20)
					.map((rows) => {
						// Bound repeated evidence while retaining each assurance label and its provenance.
						const representatives = [
							...new Map(rows.map((f) => [f.assurance, f])).values(),
						];
						return (
							representatives.map(line).join("\n") +
							(rows.length > representatives.length
								? `\n  （同じ主張の根拠は計${rows.length}件。全件は台帳に保存）`
								: "")
						);
					})
					.join("\n")
			: "（まだありません）",
		"確認済みの知見は、仮説を変えても証明し直さずに使ってよい。未確認の知見は、使う前に確かめること。",
		deadEnds.length
			? [
					"## 行き止まり（同じ経路を繰り返さない）",
					...deadEnds.slice(-10).map(line),
				].join("\n")
			: "",
		superseded.length
			? [
					"## 置き換え済み（前の方針の上で得たもの）",
					...superseded.map(line),
				].join("\n")
			: "",
		forProposal
			? [
					"## 知見の記録",
					"findings に、この一手までに得た、仮説から切り離して残す価値のあるもの（成り立つ部分的な主張・反例・観測）を最大 3 件書く。scope は、その知見が依って立つ前提（pursuit=前提なし、strategy=今の方針、hypothesis=今の仮説）。誤りと分かった知見は refute に F番号（例: F3）と理由を書く。この一手で使う知見は uses に F番号を書く。",
					"成果物の中で独立に成り立つ部分（補題など）は、見出しで分けておくと、完了の申告のときの照合で個別に確かめられ、確認済みの知見として残ることがある。",
				].join("\n")
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

/** The current strategy's parts and the latest self-assessment (selfCheck "parts"). */
function partsBlock(view: PursuitView) {
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	if (view.input.conditions.selfCheck !== "parts" || !strategy?.parts.length)
		return "";
	const label = { done: "済み", blocked: "詰まり", untried: "未着手" } as const;
	return [
		"## 方針の部品と最新の自己評価",
		...strategy.parts.map((text, i) => {
			const a = strategy.assessment?.find((x) => x.part === i + 1);
			if (!a) return `- 部品${i + 1}: ${text} → 未評価`;
			return `- 部品${i + 1}: ${text} → ${label[a.status]}${a.evidence ? `（${clip(a.evidence, 200)}）` : ""}${a.next ? ` 次の一手: ${clip(a.next, 200)}` : ""}`;
		}),
	].join("\n");
}

/** Alternatives listed by earlier strategies; which one a later strategy adopted is not recorded. */
function untriedBlock(view: PursuitView) {
	const listed = [...new Set(view.strategies.flatMap((s) => s.alternatives))];
	if (!listed.length) return "";
	return [
		"## これまでに挙げた別案（採ったものを除いて検討する）",
		...listed.map((a) => `- ${a}`),
	].join("\n");
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

/** Host-supplied procedural lessons; use only where the situation matches. */
function experienceBlock(view: PursuitView) {
	const items = view.input.experience ?? [];
	if (!items.length) return "";
	return [
		"## 過去の追求からの手順の教訓（状況が当てはまるときだけ使う）",
		...items.map((e) => `- ${e}`),
	].join("\n");
}

/**
 * rollback "notify": the files the latest step back reverted, shown until the next attempt
 * runs (spec/fixes-2026-10-22.md §a). Empty when nothing was reverted.
 */
function revertBlock(view: PursuitView) {
	const last = [...view.decisions]
		.reverse()
		.find((d) => Array.isArray(d.basis.reverted));
	if (!last || last.basis.attemptsAtRevert !== view.attempts.length) return "";
	const files = (last.basis.reverted as JsonValue[]).map(String);
	return [
		"## 作業領域の巻き戻し（直前の振り返りで実施）",
		files.length
			? `前の仮説を始めた時点の内容に戻したファイル: ${files.join(", ")}`
			: "巻き戻しを行ったが、内容の変わったファイルはなかった。",
		"これらのファイルに前の仮説で加えた変更は残っていません。必要なら読み直してください。",
	].join("\n");
}

export function planRequest(input: {
	view: PursuitView;
	tools: readonly ToolDescriptor[];
	direction: string | null;
}): LlmRequest<Plan> {
	const { view } = input;
	const parts = view.input.conditions.selfCheck === "parts";
	return {
		purpose: "plan",
		system: executorSystem,
		schema: (parts ? planWithPartsSchema : planSchema) as z.ZodType<Plan>,
		maxOutputTokens: 4000,
		prompt: [
			goalBlock(view),
			"## 使える道具",
			toolsBlock(input.tools, view.input.grant),
			historyBlock(view),
			findingsBlock(view, false),
			revertBlock(view),
			consultationsBlock(view),
			experienceBlock(view),
			input.direction ? `## 振り返りからの方向づけ\n${input.direction}` : "",
			"## 依頼",
			...(view.input.conditions.strategyChange === "distinct"
				? [
						untriedBlock(view),
						view.strategies.length
							? "これまでの方針はうまくいきませんでした。前提を見直し、これまでのどの方針とも核となる考え方（使う対象・道具立て・論法）が違う方針を一つ立ててください。同じ手法の言い換えや細部の修正は別の方針ではありません。試していない別案から選ぶか、新しく考えてください。rationale には、前の方針との違いと、前の方針が行き詰まった点をこの方針がどう避けるかを書いてください。"
							: "目標に向かう方針を一つ立ててください。選んだ理由も書いてください。",
						"alternatives には、選んだ方針と核となる考え方が違う別案を 2〜4 件、それぞれ一文で書いてください（同じ手法の変形は不可）。",
					]
				: [
						view.strategies.length
							? "これまでの方針はうまくいきませんでした。前提を見直し、別の方針を一つ立ててください。試していない別案も挙げてください。"
							: "目標に向かう方針を一つ立ててください。選んだ理由と、試していない別案も挙げてください。",
					]),
			parts
				? "parts には、この方針が成り立つのに要る部品（示すべき主張・作るべきもの）を 1〜6 件、順に一文ずつ書いてください。部品がすべて済めば目標に届く、という分け方にしてください。"
				: "",
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
	const last = view.decisions.at(-1);
	const direction =
		last?.kind === "change_hypothesis" &&
		typeof last.basis.direction === "string"
			? last.basis.direction
			: null;
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
			findingsBlock(view, false),
			lastAttemptsBlock(view, 6),
			revertBlock(view),
			consultationsBlock(view),
			`## 現在の方針\n${strategy?.body ?? ""}`,
			partsBlock(view),
			experienceBlock(view),
			direction ? `## 振り返りからの方向づけ\n${direction}` : "",
			"## 依頼",
			"この方針の下で、次に確かめる仮説を一つ立ててください（「Xをすれば、Yになるはず」）。使う道具と、成り立つときに観測される結果も書いてください。前の仮説と同じものは立てないでください。",
			view.input.conditions.selfCheck === "parts"
				? "部品のうち、まだ済んでいないものを一つ選び、それを進める仮説にしてください。詰まりに次の一手が書かれていれば、それを優先してください。"
				: "",
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

/** The latest re-read of the deliverable, in full, for judging completion (spec/completion-design.md). */
function readBackBlock(view: PursuitView, tools: readonly ToolDescriptor[]) {
	if (view.input.conditions.completionCheck !== "acceptance") return "";
	const readers = new Set(tools.filter((t) => t.readsBack).map((t) => t.name));
	const last = [...view.attempts]
		.reverse()
		.find(
			(a) =>
				a.state === "settled" &&
				readers.has(a.tool) &&
				a.observation?.status === "ok",
		);
	if (!last?.observation) return "";
	const changedSince = view.attempts.some(
		(a) =>
			a.seq > last.seq &&
			a.state === "settled" &&
			tools.some((t) => t.name === a.tool && t.sideEffect === "workspace"),
	);
	return [
		`## 最後に読み返した成果物（試行 #${last.seq}${changedSince ? "。そのあと書き換えたので古い" : ""}）`,
		show(last.observation.output, 12000),
	].join("\n");
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
		// The findings fields exist only when the condition is on, so "off" stays the baseline.
		schema: proposalSchemaFor(view.input.conditions),
		maxOutputTokens: 10000,
		prompt: [
			goalBlock(view),
			"## 使える道具",
			toolsBlock(input.tools, view.input.grant),
			historyBlock(view),
			findingsBlock(view, true),
			consultationsBlock(view),
			`## 現在の方針\n${strategy?.body ?? ""}`,
			partsBlock(view),
			revertBlock(view),
			readBackBlock(view, input.tools),
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
				view.input.conditions.prediction === "falsifiable"
					? "  kind が tool のときは refutedIf も書く。どんな観測が出たらこの仮説が誤りと分かるかを、予測とは別の具体的な観測で書く（予測の言い換えや空欄は受け付けません）。"
					: "",
				view.input.conditions.verifyOn === "claim"
					? '- kind "done": 受入条件を満たしたと考える。message に根拠を書く。照合は done を申告したときだけ行われ、試行のたびには行われません。受入条件を満たしたと考えたら、自分で done を選んでください。'
					: '- kind "done": 受入条件を満たしたと考える。message に根拠を書く（照合されます）。',
				'- kind "consult": 利用者に相談する。message に問い、missing に足りないものを書く。',
				'- kind "give_up": 達成できないと判断した。message に理由を書く。',
				'- kind "step_back": この仮説では進まないので振り返る。message に理由を書く。',
				"使わない項目は null または空文字にしてください。",
				view.input.conditions.completionCheck === "acceptance"
					? "step_back と give_up を選ぶ前に、成果物を全文読み返す道具で今の成果物を読み直し、その全文に照らして受入条件を一つずつ判断してください。acceptanceCheck に、すべての受入条件について id・met（満たしているか）・where（満たしているなら成果物のどの箇所か、満たしていないなら何が欠けているか）を書きます。step_back と give_up では必須で、それ以外は空配列でよいです。すべて満たしているなら、step_back ではなく done を申告してください。"
					: "",
				view.input.conditions.selfCheck === "parts"
					? "step_back と give_up を選ぶ前に、方針の部品ごとに自己評価してください。assessment に、すべての部品について part（番号）・status（done=済み、blocked=詰まり、untried=未着手）・evidence（済みならその根拠、詰まりなら何が足りないか）・next（詰まりのとき、次に試せる一手。本当にもう無いときだけ空）を書きます。step_back と give_up では必須で、それ以外は空配列でよいです。未着手の部品や、次の一手が残っている部品があるうちは、方針を捨てずにその部品に取り組んでください。"
					: "",
			]
				.filter(Boolean)
				.join("\n"),
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
			findingsBlock(view, false),
			partsBlock(view),
			`## 試していない別案\n${(strategy?.alternatives ?? []).map((a) => `- ${a}`).join("\n") || "（なし）"}`,
			consultationsBlock(view),
			"## 依頼\n方針レベルで判断してください。direction には、次の方針や相談の方向を一文で書いてください。",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}
