import { findingClaimKey } from "../ledger/findings.ts";
import { refutationHeld } from "../rules/refutation.ts";
import { z } from "zod";
import type {
	JsonValue,
	LlmRequest,
	ToolDescriptor,
} from "../../contracts/index.ts";
import type { AttemptRow, PursuitView } from "../ledger/types.ts";

/**
 * Display clip for text that is not a tool observation (inputs, statements, evidence): says how
 * much was shown. Observations use observationText, which also says how to read the rest.
 */
const clip = (text: string, limit: number) =>
	text.length <= limit
		? text
		: `${text.slice(0, limit)}…［表示は全 ${text.length} 字のうち先頭 ${limit} 字。台帳には全文がある］`;
const show = (value: JsonValue, limit: number) =>
	clip(JSON.stringify(value), limit);
/** A tool input (not an observation): labelled so its clip is not read as the observation's (fixes g §3). */
const showInput = (value: JsonValue, limit: number) => {
	const text = JSON.stringify(value);
	return text.length <= limit
		? text
		: `${text.slice(0, limit)}…［入力の表示は全 ${text.length} 字のうち先頭 ${limit} 字（観測ではない）。台帳には全文がある］`;
};

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
	/** Files or directories the hypothesis will change (v1.8); [] when it changes none or cannot say. */
	targets: z.array(z.string()).max(30).default([]),
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

/** The verdict shown for an executed attempt (conditions.verdictLabel, spec/fixes-2026-10-22.md §b). */
export function verdictText(
	a: AttemptRow,
	mode: "refutation" | "status" = "refutation",
): string {
	if (mode === "status")
		return a.outcome === "success" ? "予測どおり" : "予測と違う/失敗";
	// Refutation first (spec/fixes-2026-10-22-d.md §3.4): a stated refutedIf decides the label, and a
	// status other than predicted is said as a separate fact, not as the verdict.
	const held = refutationHeld(a.prediction.refutedIf, a.observation);
	const statusDiffers =
		!!a.observation && a.observation.status !== a.prediction.expectedStatus;
	const statusNote = statusDiffers
		? `状態は予測の ${a.prediction.expectedStatus} ではなく ${a.observation!.status}`
		: "状態も予測どおり";
	// The display may be clipped; the verdict is on the full text (§3.1), and says so.
	const fullNote = a.observation?.unclipped?.length
		? "。表示は一部省略だが、判定は省略部分を含む全文で行った"
		: "";
	if (held === true)
		return `反証の条件に当たった（仮説は誤りの可能性が高い${fullNote}）`;
	if (held === false)
		return `反証の条件に当たらなかった（${statusNote}${fullNote}）`;
	if (statusDiffers) return `予測と違う（${statusNote}）`;
	if (a.outcome === "failure") return "予測と違う（観測の照合）";
	return a.prediction.refutedIf?.trim()
		? "未判定（状態は予測どおり。反証の条件は機械では判定できない書き方）"
		: "未判定（状態は予測どおり。反証の条件なし）";
}

/** Whether a tool reads in pages: its input schema has offset and limit. */
function pages(tool: ToolDescriptor | undefined): boolean {
	const props = (tool?.inputSchema as { properties?: Record<string, unknown> })
		?.properties;
	return !!props && "offset" in props && "limit" in props;
}

/**
 * An observation clipped to `limit` characters of its JSON text, saying how long it was and how
 * to read the rest (spec/fixes-2026-10-22.md §f). Clipping is only in this prompt; the ledger
 * keeps the whole observation. The direct baseline (eval/direct.ts) uses the same words.
 */
export function observationText(
	output: JsonValue,
	limit: number,
	tool: ToolDescriptor | undefined,
) {
	const text = JSON.stringify(output);
	if (text.length <= limit) return text;
	const how = tool?.reread
		? tool.reread
		: pages(tool)
			? `この道具は offset / limit で続きを読めます（単位は道具の説明のとおり）`
			: `範囲や件数を絞って呼び直すか、結果をファイルに書いて分けて読んでください`;
	return `${text.slice(0, limit)}…［観測は全 ${text.length} 字のうち先頭 ${limit} 字だけ表示。${how}］`;
}

function attemptLine(
	a: AttemptRow,
	limit: number,
	mode: "refutation" | "status" = "refutation",
	shown: { chars: number; tools: readonly ToolDescriptor[] } = {
		chars: limit * 3,
		tools: [],
	},
) {
	const head = `#${a.seq} ${a.tool} ${showInput(a.input, limit)}`;
	const prediction = `予測: ${a.prediction.expectedStatus} / ${clip(a.prediction.expectedObservation || "（なし）", limit)}${a.prediction.refutedIf ? `\n  反証の条件: ${clip(a.prediction.refutedIf, limit)}` : ""}`;
	if (a.state === "rejected")
		return `${head}\n  ${prediction}\n  拒否: ${(a.rejection ?? []).map((r) => `${r.rule}: ${r.detail}`).join(" / ")}`;
	if (a.state === "interrupted")
		return `${head}\n  ${prediction}\n  中断（実行結果・副作用の有無は不明）`;
	const observed = a.observation
		? `${a.observation.status}${a.observation.errorCode ? `(${a.observation.errorCode})` : ""} ${observationText(
				a.observation.output,
				shown.chars,
				shown.tools.find((t) => t.name === a.tool),
			)}`
		: "（未観測）";
	return `${head}\n  ${prediction}\n  観測: ${observed}\n  判定: ${verdictText(a, mode)}`;
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
		(a, b) => order[a.assurance] - order[b.assurance] || a.seq - b.seq,
	);
	const groups = new Map<string, typeof shown>();
	for (const f of shown) {
		const key = findingClaimKey(f);
		const rows = groups.get(key) ?? [];
		rows.push(f);
		groups.set(key, rows);
	}
	// findings "verified": the generator's own (unverified) findings are recorded but not shown
	// until a check confirms them; say how many there are instead of "none yet" (§2).
	const hidden = view.findings.filter(
		(f) =>
			f.status === "active" &&
			f.kind !== "dead_end" &&
			mode === "verified" &&
			f.assurance === "unverified",
	);
	const hiddenNote = hidden.length
		? `記録した未確認の知見 ${hidden.length} 件（${hidden
				.slice(-10)
				.map((f) => `F${f.seq}`)
				.join(
					", ",
				)}${hidden.length > 10 ? " ほか" : ""}）は台帳にあるが、この条件（findings: verified）では照合で確かめられるまで本文を表示しない。番号での引用はできる。`
		: "";
	const deadEnds = view.findings.filter((f) => f.kind === "dead_end");
	// Refuted findings stay citable as one line each (spec/fixes-2026-10-22-f.md §C).
	const refuted = view.findings.filter((f) => f.status === "refuted");
	const superseded = view.findings
		.filter((f) => f.status === "superseded" && f.kind !== "dead_end")
		.slice(-5);
	const line = (f: PursuitView["findings"][number]) =>
		`- F${f.seq} [${f.kind}・${assuranceLabel[f.assurance]}・${scopeLabel(view, f)}] ${clip(f.statement, 800)}${f.sourceAttemptId || f.sourceVerificationId ? ` (出典: ${f.sourceAttemptId ?? f.sourceVerificationId})` : ""}`;
	return [
		"## 知見（仮説を変えても残る）",
		shown.length
			? "（確かさの順、同じ確かさの中は番号の古い順。F 番号は記録の順に振られ、行き止まり・反証済み・置き換え済みも同じ番号列なので、ここに無い番号がある）"
			: "",
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
			: hidden.length
				? "（照合済みの知見はまだありません）"
				: `（まだありません。実行した試行 ${view.attempts.filter((a) => a.state === "settled" || a.state === "interrupted").length} 回）`,
		hiddenNote,
		"確認済みの知見は、仮説を変えても証明し直さずに使ってよい。未確認の知見は、使う前に確かめること。",
		// spec/fixes-2026-10-22-e.md §5: promotion is not wired, and the request says so.
		"確認済み（確定・数値で確認・採点で確認）になるのは、ホストが自ら記録した知見と、検査が個別に確かめた知見だけ。生成側が記録した知見は、引用した試行が予測どおりでも、申告が合格しても未確認のまま（検査はどの知見が正しかったかまでは示さないため）。",
		deadEnds.length
			? [
					"## 行き止まり（同じ経路を繰り返さない。ホストが記録し、知見と同じ F 番号列を使う）",
					...deadEnds.slice(-10).map(line),
				].join("\n")
			: "",
		refuted.length
			? [
					"## 反証済み（使わない。番号は引用できる。誤って反証したと分かったら、同じ主張を根拠の試行とともに新しい知見として記録し直す。元の番号は反証済みのまま残る）",
					...refuted
						.slice(-10)
						.map(
							(f) =>
								`- F${f.seq} 反証済み: ${clip(f.statement, 120)} ／ 理由: ${clip(f.reason ?? "（なし）", 300)}`,
						),
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
					(() => {
						const next = Math.max(0, ...view.findings.map((f) => f.seq)) + 1;
						return `次に記録される知見の番号は F${next} から。この一手の findings は書いた順に F${next}, F${next + 1}, F${next + 2} になる。ホストが記録する行き止まり（一段上へ戻るとき）も同じ番号列を使うので、次の一手より先の番号を先回りして引用しない。`;
					})(),
					"findings に、この一手までに得た、仮説から切り離して残す価値のあるもの（成り立つ部分的な主張・反例・観測）を最大 3 件書く。scope は、その知見が依って立つ前提（pursuit=前提なし、strategy=今の方針、hypothesis=今の仮説）。誤りと分かった知見は refute に F番号（例: F3）と理由を書く。この一手で使う知見は uses に F番号を書く。",
					"成果物の中で独立に成り立つ部分（補題など）は、見出しで分けておくと、完了の申告のときの照合で個別に確かめられ、確認済みの知見として残ることがある。",
					"定義・数値・原因の特定・反例のように、あとで使う事実が分かる観測を得たら、その次の一手の findings に残す（毎手でなくてよい）。自己評価・申告・message で知見に触れるときは F番号で引用する。台帳にない F番号の引用は受け付けられない。",
				].join("\n")
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Findings on, none recorded after several executed attempts: a light reminder in the plan and
 * hypothesis requests (spec/fixes-2026-10-22.md §e). Not a requirement on every step.
 */
function findingsReminder(view: PursuitView) {
	if (view.input.conditions.findings === "off") return "";
	const executed = view.attempts.filter(
		(a) => a.state === "settled" || a.state === "interrupted",
	).length;
	const recorded = view.findings.filter((f) => f.kind !== "dead_end").length;
	if (recorded > 0 || executed < 5) return "";
	return `知見: 0 件（実行した試行 ${executed} 回のあと）。これまでの観測で確かめた事実があれば、次の提案の findings に記録してください。`;
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

/**
 * Host notes on the self-assessment, for the reviewer (spec/fixes-2026-10-22-g.md §9). Heuristic and
 * advisory: a 詰まり part at a routine step back, and a 済み part when every attempt executed under
 * the strategy used only read-only tools.
 */
/** Part text that promises an action beyond reading (fixes h §3); heuristic. */
const PROMISES_ACTION =
	/実行|走らせ|動かし|再現|比較|突き合わせ|照合|テスト|検証|計算|集計|書き(込|出|換|直)|修正|直す|変更|置き換|実装|生成|作成|提出|問い合わせ|\b(run|execute|compare|test|verify|fix|write|submit)\b/i;

export function partsCheckBlock(
	view: PursuitView,
	tools: readonly ToolDescriptor[],
): string {
	const strategy = view.strategies.find((s) => s.id === view.currentStrategyId);
	if (view.input.conditions.selfCheck !== "parts" || !strategy?.assessment)
		return "";
	const notes: string[] = [];
	const blocked = strategy.assessment.filter((a) => a.status === "blocked");
	if (blocked.length && stepBackKind(view).startsWith("定例"))
		notes.push(
			`- 定例の区切りだが、自己評価では部品${blocked.map((a) => a.part).join("・")}が詰まり。区切りと詰まりのどちらが実情かを確かめること。`,
		);
	const done = strategy.assessment.filter((a) => a.status === "done");
	const hyps = new Set(
		view.hypotheses
			.filter((h) => h.strategyId === strategy.id)
			.map((h) => h.id),
	);
	const ran = view.attempts.filter(
		(a) => a.state === "settled" && a.hypothesisId && hyps.has(a.hypothesisId),
	);
	// fixes h §3: a tool whose observations report calls_left (probe) is an experiment with its own
	// budget, not reading; and only parts whose text promises running, comparing or changing count.
	const metered = new Set(
		view.attempts
			.filter(
				(a) =>
					!!a.observation?.output &&
					typeof a.observation.output === "object" &&
					!Array.isArray(a.observation.output) &&
					typeof (a.observation.output as Record<string, unknown>)
						.calls_left === "number",
			)
			.map((a) => a.tool),
	);
	const readOnly = new Set(
		tools
			.filter((t) => t.sideEffect === "none" && !metered.has(t.name))
			.map((t) => t.name),
	);
	const promising = done.filter((a) =>
		PROMISES_ACTION.test(strategy.parts[a.part - 1] ?? ""),
	);
	if (
		promising.length &&
		tools.length &&
		ran.length &&
		ran.every((a) => readOnly.has(a.tool))
	)
		notes.push(
			`- 部品${promising.map((a) => a.part).join("・")}は実行・比較・変更を含む部品として済みとされたが、この方針で実行した試行 ${ran.length} 回はすべて読むだけの道具（${[...new Set(ran.map((a) => a.tool))].join(", ")}）。済みの根拠を確かめること。`,
		);
	return notes.length
		? [
				"## 自己評価についてのホストの注記（簡易な照合。誤りとは限らない）",
				...notes,
			].join("\n")
		: "";
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

// "なし", or a sentence that opens by saying no premise broke (hz11i: 「壊れた前提はない。注意点は…」).
const NO_PREMISE =
	/^\s*(?:$|(?:なし|特になし|無し|ない|-|—|（なし）|none|(?:壊れた|崩れた|誤った)?前提は?(?:ない|なし|ありません|崩れていない|壊れていない))(?:[。．.、\s]|$))/i;
/**
 * A strategy's premise corrections from reviews that kept it (spec/fixes-2026-10-22-e.md §4): the
 * plan text is the ledger's and is not rewritten; the correction is shown with it from then on.
 */
function premiseFixes(view: PursuitView, strategyId: string): string {
	const fixes = view.decisions
		.map(
			(d) =>
				d.basis?.review as
					| {
							decision?: string;
							brokenAssumption?: string;
							strategyId?: string;
					  }
					| null
					| undefined,
		)
		.filter(
			(r) =>
				r?.strategyId === strategyId &&
				r.decision === "continue_strategy" &&
				!NO_PREMISE.test(r.brokenAssumption ?? ""),
		)
		.map((r) => clip(r!.brokenAssumption!, 300));
	return fixes.length
		? fixes
				.slice(-3)
				.map(
					(f) => `\n    ［振り返りでの前提の修正（方針の文面より優先）: ${f}］`,
				)
				.join("")
		: "";
}

/**
 * Earlier strategies and hypotheses. A closed hypothesis shows how it ended (its result names who
 * decided, spec/fixes-2026-10-22-c.md §3); the open one shows its executed attempts, and in a
 * review request it is the hypothesis being reviewed, not one still "in progress" (§4).
 */
/**
 * The one tally of a hypothesis's attempts (spec/fixes-2026-10-22-f.md §D): the same verdicts as each
 * attempt line, used by every request that counts a hypothesis's attempts and by host dead ends.
 */
export function attemptTally(view: PursuitView, hypothesisId: string): string {
	const mine = view.attempts.filter((a) => a.hypothesisId === hypothesisId);
	const ran = mine.filter(
		(a) => a.state === "settled" || a.state === "interrupted",
	).length;
	const tally = { held: 0, refuted: 0, differs: 0, open: 0 };
	for (const a of mine) {
		if (a.state === "interrupted") tally.open++;
		if (a.state !== "settled") continue;
		const held = refutationHeld(a.prediction.refutedIf, a.observation);
		if (held === true) tally.refuted++;
		else if (held === false) tally.held++;
		else if (
			a.observation &&
			(a.observation.status !== a.prediction.expectedStatus ||
				a.outcome === "failure")
		)
			tally.differs++;
		else tally.open++;
	}
	const rejected = mine.filter((a) => a.state === "rejected").length;
	return `実行した試行 ${ran} 回: 反証の条件に当たらなかった ${tally.held}・当たった ${tally.refuted}${tally.differs ? `・予測と違う ${tally.differs}` : ""}・未判定 ${tally.open}。拒否 ${rejected} 回`;
}

function historyBlock(view: PursuitView, reviewing = false) {
	if (!view.hypotheses.length) return "";
	const open = (h: PursuitView["hypotheses"][number]) => {
		if (!(reviewing && h.id === view.currentHypothesisId)) {
			const ran = view.attempts.filter(
				(a) =>
					a.hypothesisId === h.id &&
					(a.state === "settled" || a.state === "interrupted"),
			).length;
			return `試行中（実行した試行 ${ran} 回）`;
		}
		return `この振り返りの対象（${attemptTally(view, h.id)}）`;
	};
	return [
		"## これまでの方針と仮説",
		...view.strategies.map((s) =>
			[
				`- 方針${s.seq}: ${s.body}${premiseFixes(view, s.id)}${s.closeReason ? `（終了: ${clip(s.closeReason, 800)}）` : ""}`,
				...view.hypotheses
					.filter((h) => h.strategyId === s.id)
					.map(
						(h) =>
							`  - 仮説${h.seq}: ${h.body} → ${h.result === null ? open(h) : `${clip(h.result, 800)}${reviewing && h.strategyId === view.currentStrategyId ? `（${attemptTally(view, h.id)}）` : ""}`}`,
					),
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
 * runs (spec/fixes-2026-10-22.md §a). Task files are named (up to 20); generated outputs and
 * the scratch work that was kept are only counted (spec/fixes-2026-10-22-b.md §1).
 */
function revertBlock(view: PursuitView) {
	const last = [...view.decisions]
		.reverse()
		.find((d) => Array.isArray(d.basis.reverted));
	if (!last || last.basis.attemptsAtRevert !== view.attempts.length) return "";
	const files = (last.basis.reverted as JsonValue[]).map(String);
	const generated = Number(last.basis.revertedGenerated ?? 0);
	const kept = Number(last.basis.keptScratch ?? 0);
	const listed = files.slice(0, 20);
	return [
		"## 作業領域の巻き戻し（直前の振り返りで実施）",
		files.length
			? `前の仮説を始めた時点の内容に戻した課題のファイル（${files.length} 件）: ${listed.join(", ")}${files.length > listed.length ? ` ほか ${files.length - listed.length} 件` : ""}`
			: generated
				? "課題のファイルで戻したものはない。"
				: "巻き戻しを行ったが、内容の変わったファイルはなかった。",
		generated
			? `コマンドが作った生成物 ${generated} 件も前の状態に戻した（一覧は省略）。`
			: "",
		kept
			? `作業用ディレクトリ（scratch など）の ${kept} 件は戻さず、そのまま残した。`
			: "",
		files.length || generated
			? "これらのファイルに前の仮説で加えた変更は残っていません。必要なら読み直してください。"
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * The hypothesis budget, when the last decision re-plans a strategy the review chose to continue
 * (spec/fixes-2026-10-22-f.md §A); 0 otherwise.
 */
function continuing(view: PursuitView): number {
	const last = view.decisions.at(-1);
	return last?.kind === "revise_strategy" && last.basis?.continuation === true
		? Number(last.basis.hypothesesPerStrategy ?? 0) || 0
		: 0;
}

/** One claim verdict line; the direct baseline (eval/direct.ts) uses the same words. */
export function claimVerdictText(
	criteria: readonly { id: string; passed: boolean; evidence: string }[],
	passed: boolean,
): string {
	// Evidence that only repeats the criterion's verdict (--claim-evidence binary) is not shown
	// again: 「合格: [hidden-checks] ok」, not 「… ok 合格」 (spec/fixes-2026-10-22-c.md §2).
	const said = (r: { passed: boolean; evidence: string }) =>
		r.evidence.trim() === (r.passed ? "合格" : "不合格")
			? ""
			: ` ${clip(r.evidence, 300)}`;
	return `${passed ? "合格" : "不合格"}: ${criteria.map((r) => `[${r.id}] ${r.passed ? "ok" : "ng"}${said(r)}`).join(" / ")}`;
}

/** claimFeedback "verdict": every claim's result, in every later generator and reviewer prompt. */
function claimFeedbackBlock(view: PursuitView) {
	if (view.input.conditions.claimFeedback !== "verdict") return "";
	const claims = view.verifications.filter((v) => v.trigger === "claim");
	if (!claims.length) return "";
	return [
		"## 完了の申告の結果（ホストの照合）",
		...claims.map(
			(c, i) => `- 申告${i + 1}: ${claimVerdictText(c.criteria, c.passed)}`,
		),
		claims.at(-1)!.passed
			? ""
			: "直近の完了の申告は不合格でした。受入条件はまだ満たされていません。",
	]
		.filter(Boolean)
		.join("\n");
}

/** Attempts that count toward a hypothesis budget (conditions.attemptCount). */
export function budgetCounted(
	view: PursuitView,
	attempts: readonly AttemptRow[],
	tools: readonly ToolDescriptor[],
): AttemptRow[] {
	const executed = attempts.filter(
		(a) => a.state === "settled" || a.state === "interrupted",
	);
	if (view.input.conditions.attemptCount !== "mutating") return executed;
	const writers = new Set(
		tools.filter((t) => t.sideEffect === "workspace").map((t) => t.name),
	);
	return executed.filter((a) => writers.has(a.tool));
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
			findingsReminder(view),
			revertBlock(view),
			claimFeedbackBlock(view),
			consultationsBlock(view),
			experienceBlock(view),
			input.direction ? `## 振り返りからの方向づけ\n${input.direction}` : "",
			"## 依頼",
			...(continuing(view)
				? [
						`方針${view.strategies.at(-1)?.seq ?? "?"}は誤りで終わったのではなく、方針あたりの仮説の上限（${continuing(view)} 件）に達したため、規則で新しい方針として立て直す。振り返りはこの方針を続けるよう勧めている。前の方針の考え方と、その下で得た知見を引き継ぎ、残りの部分に絞った方針を一つ書いてください（核となる考え方を変える必要はない）。`,
						"alternatives には、うまくいかなかったときの別案を 1〜4 件、それぞれ一文で書いてください。",
					]
				: view.input.conditions.strategyChange === "distinct"
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
			findingsReminder(view),
			lastAttemptsBlock(view, 6, input.tools),
			revertBlock(view),
			claimFeedbackBlock(view),
			consultationsBlock(view),
			`## 現在の方針\n${strategy?.body ?? ""}`,
			partsBlock(view),
			experienceBlock(view),
			direction ? `## 振り返りからの方向づけ\n${direction}` : "",
			"## 依頼",
			`この方針で立てる仮説は ${view.hypotheses.filter((h) => h.strategyId === view.currentStrategyId).length + 1}/${view.input.policy.budget.hypothesesPerStrategy} 件目（上限に達した仮説が閉じると、規則で方針を立て直す。仮説ごとの試行予算は ${view.input.policy.budget.attemptsPerHypothesis} 回）。`,
			"この方針の下で、次に確かめる仮説を一つ立ててください（「Xをすれば、Yになるはず」）。使う道具と、成り立つときに観測される結果も書いてください。前の仮説と同じものは立てないでください。",
			input.tools.some((t) => t.sideEffect === "workspace")
				? "targets には、この仮説で変えるつもりのファイルかディレクトリ（例: src/pricing/）を書いてください。課題のファイルを変えない仮説（読む、調べる、scratch/ で計算するだけ）なら空にします。空でも変更は拒否されず、最初に変えたファイルのディレクトリがその仮説の範囲になります。ただし仮説は一つの主張なので、読むだけの仮説から「直す」仮説へ移るときは、step_back で区切って新しい仮説を立てます（区切りごとに振り返りが入るのは設計どおり）。直すつもりがあるなら、この仮説で実際に変えるファイルかディレクトリだけを最初から targets に書けば区切りは要りません。確かめていない場所や「念のため」の場所は書かないでください（広く書くほど、範囲の拡大という兆候が見えなくなります）。scratch/ などの作業用ディレクトリは書かなくてかまいません。宣言した範囲と、すでに変えたディレクトリの中なら、いくつのファイルを直しても範囲の拡大とは数えません。範囲の外へ試行のたびに広がると、兆候として一段上へ戻されます。"
				: "",
			view.input.conditions.selfCheck === "parts"
				? "部品のうち、まだ済んでいないものを一つ選び、それを進める仮説にしてください。詰まりに次の一手が書かれていれば、それを優先してください。"
				: "",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

/**
 * One rule everywhere (spec/fixes-2026-10-22-g.md §3): the latest executed attempt's observation gets
 * policy.observation.latestChars, every older one olderChars. Inputs and predictions are clipped separately.
 */
function observedFor(view: PursuitView, tools: readonly ToolDescriptor[]) {
	const latest = [...view.attempts]
		.reverse()
		.find((a) => a.state === "settled" || a.state === "interrupted");
	const limits = view.input.policy.observation;
	return (a: AttemptRow) => ({
		chars: a.id === latest?.id ? limits.latestChars : limits.olderChars,
		tools,
	});
}

/** fixes g §8: the #numbers are the task's running count, so they need not start at this hypothesis. */
const ATTEMPT_NUMBERS =
	"（#番号はこの課題の試行の通し番号。前の仮説・方針の試行と拒否された提案も数える）";

function lastAttemptsBlock(
	view: PursuitView,
	n: number,
	tools: readonly ToolDescriptor[],
) {
	const shown = view.attempts.slice(-n);
	if (!shown.length) return "";
	const observed = observedFor(view, tools);
	return [
		"## 直近の試行",
		ATTEMPT_NUMBERS,
		...shown.map((a) =>
			attemptLine(a, 300, view.input.conditions.verdictLabel, observed(a)),
		),
	].join("\n");
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
			`## 現在の仮説\n${hypothesis?.body ?? ""}\n期待する結果: ${hypothesis?.expected ?? ""}${hypothesis?.targets.length ? `\n変える対象（宣言）: ${hypothesis.targets.join(", ")}` : ""}\n試行予算: ${view.input.conditions.attemptCount === "mutating" ? `${budgetCounted(view, mine, input.tools).length}/${hypothesis?.budget ?? 0}（数えるのは作業領域を変える道具だけ）` : `${mine.filter((a) => a.state !== "rejected").length}/${hypothesis?.budget ?? 0}`}`,
			mine.length
				? [
						"## この仮説での試行",
						ATTEMPT_NUMBERS,
						...mine.map((a) =>
							attemptLine(
								a,
								600,
								view.input.conditions.verdictLabel,
								observedFor(view, input.tools)(a),
							),
						),
					].join("\n")
				: "## この仮説での試行\nまだありません。",
			view.input.conditions.claimFeedback === "verdict"
				? claimFeedbackBlock(view)
				: claims.length
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
				view.input.conditions.prediction === "falsifiable" &&
				view.input.conditions.verdictLabel === "refutation"
					? '  refutedIf を status:ok / status:error / contains:"文字列" / not_contains:"文字列" の形（|| で複数並べると、どれか一つで反証）で書くと、ホストが観測と突き合わせて判定を示す。文字列は観測に表示されたとおりに書く（JSON の形でも、値の文字列でもよい）。それ以外の書き方は「未判定」と表示される。'
					: "",
				view.input.conditions.verifyOn === "claim"
					? '- kind "done": 受入条件を満たしたと考える。message に根拠を書く。照合は done を申告したときだけ行われ、試行のたびには行われません。受入条件を満たしたと考えたら、自分で done を選んでください。'
					: '- kind "done": 受入条件を満たしたと考える。message に根拠を書く（照合されます）。',
				'- kind "consult": 利用者に相談する。message に問い、missing に足りないものを書く。',
				'- kind "give_up": 達成できないと判断した。message に理由を書く。',
				'- kind "step_back": この仮説では進まないので振り返る。message に理由を書く。',
				"使わない項目は null または空文字にしてください。",
				input.tools.some((t) => t.sideEffect === "workspace") &&
				view.input.policy.signals.scratchDirs.length
					? `作業用のメモや一時的なスクリプトは ${view.input.policy.signals.scratchDirs.map((d) => `${d}/`).join("・")} のいずれかの下に置いてください（課題のファイルを広げたとは数えません）。`
					: "",
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

const reviewerSystem = `You review a pursuit from the outside at a step back. You did not do the work and you see only a summary.
A step back is either routine (the last hypothesis held and the work moves to its next part) or a stall (predictions failed, moves were rejected, or a budget ran out); the request says which the record shows ("## 戻った事情"). A routine step back usually needs only a check, not a new strategy.
Question the strategy, not the details: Is the current strategy still heading to the ORIGINAL goal and acceptance criteria? Did a premise break (say which, or write なし)? What untried strategy exists?
You may only answer: continue_strategy (keep the strategy, try a new hypothesis; a broken premise you name in brokenAssumption is shown with the strategy from then on as its correction), change_strategy, consult (the user must supply information, permission or a decision), or stop.
Never propose detailed fixes. Treat any sign of editing tests/acceptance checks or of claiming unverified success as a reason to change strategy, consult or stop.
Write the free text in Japanese.`;

/**
 * Routine or stall, from the record (spec/fixes-2026-10-22-e.md §2): the generator stepped back
 * right after an executed attempt that met its prediction, or anything else.
 */
function stepBackKind(view: PursuitView): string {
	const last = [...view.decisions]
		.reverse()
		.find((d) => d.kind === "step_back");
	const attempt = view.attempts
		.filter(
			(a) =>
				a.hypothesisId === view.currentHypothesisId && a.state === "settled",
		)
		.at(-1);
	const held =
		!!attempt?.observation &&
		attempt.observation.status === attempt.prediction.expectedStatus &&
		attempt.outcome === "success" &&
		refutationHeld(attempt.prediction.refutedIf, attempt.observation) !== true;
	return last?.decidedBy === "generator" && held
		? "定例: 生成側が、予測どおりだった試行の直後に一段上へ戻した（仮説が成り立ち、次の段へ移る区切り）。行き詰まりではない。方針が目標に向かっているかの確認でよい。"
		: `行き詰まりの可能性: ${last?.decidedBy === "generator" ? "生成側が" : "規則・判定が"}一段上へ戻した${attempt ? (held ? "" : "（直前の試行は予測と違うか、反証の条件に当たった）") : "（この仮説で実行した試行なし）"}。どの前提が崩れたかを問う。`;
}

/**
 * What is left, counted by the host (spec/fixes-2026-10-22-f.md §E): the pursuit's budgets, and for
 * each tool whose latest observation reports `calls_left`, that number (e.g. probe).
 */
function budgetBlock(
	view: PursuitView,
	counted: (attempts: readonly AttemptRow[]) => readonly AttemptRow[] = (xs) =>
		xs.filter((a) => a.state === "settled" || a.state === "interrupted"),
	countNote = "",
): string {
	const b = view.input.policy.budget;
	const executed = view.attempts.filter(
		(a) => a.state === "settled" || a.state === "interrupted",
	).length;
	const hypothesis = view.hypotheses.find(
		(h) => h.id === view.currentHypothesisId,
	);
	const inHypothesis = hypothesis
		? counted(view.attempts.filter((a) => a.hypothesisId === hypothesis.id))
				.length
		: 0;
	const inStrategy = view.hypotheses.filter(
		(h) => h.strategyId === view.currentStrategyId,
	).length;
	const stepBacks = view.decisions.filter((d) => d.kind === "step_back").length;
	const tools = new Map<string, number>();
	for (const a of view.attempts) {
		const out = a.observation?.output;
		if (
			a.state !== "settled" ||
			!out ||
			typeof out !== "object" ||
			Array.isArray(out)
		)
			continue;
		const left = (out as Record<string, unknown>).calls_left;
		if (typeof left === "number") tools.set(a.tool, left);
	}
	return [
		"## 残りの予算（ホストが数えた値）",
		`- 試行: 全体で ${executed}/${b.attempts} 回使用${hypothesis ? `、この仮説で ${inHypothesis}/${hypothesis.budget} 回${countNote}` : ""}`,
		`- 仮説: この方針で ${inStrategy}/${b.hypothesesPerStrategy} 件（上限に達すると規則で方針を立て直す）`,
		`- 方針: ${view.strategies.length}/${b.strategies} 件、一段上へ戻る: ${stepBacks}/${b.stepBacks} 回`,
		...[...tools].map(
			([tool, left]) => `- ${tool}: 残り ${left} 回（直近の観測の calls_left）`,
		),
	].join("\n");
}

export function reviewRequest(input: {
	view: PursuitView;
	reason: string;
	signals: readonly string[];
	/** The run's tools: lets the parts check tell read-only attempts apart (fixes g §9). */
	tools?: readonly ToolDescriptor[];
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
			`## 戻った事情\n${stepBackKind(view)}`,
			budgetBlock(view),
			historyBlock(view, true),
			findingsBlock(view, false),
			claimFeedbackBlock(view),
			partsBlock(view),
			partsCheckBlock(view, input.tools ?? []),
			`## 試していない別案\n${(strategy?.alternatives ?? []).map((a) => `- ${a}`).join("\n") || "（なし）"}`,
			consultationsBlock(view),
			"## 依頼\n方針レベルで判断してください。direction には、次の方針や相談の方向を一文で書いてください。",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}
