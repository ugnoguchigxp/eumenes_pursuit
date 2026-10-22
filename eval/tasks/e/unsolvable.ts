import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CriterionResult } from "../../../src/contracts/index.ts";
import type {
	EvalTask,
	OutcomeFacts,
	TaskContext,
	TaskDiagnostics,
} from "../../contracts.ts";
import {
	createToolPort,
	defineTool,
	fail,
	ok,
	prop,
	type ToolDef,
} from "../../tools/tool-port.ts";
import { createDirWorkspace } from "../../tools/workspace.ts";
import { criterion } from "../kit.ts";
import { loadSecret } from "./discovery.ts";
import { createProofGrader, loadRubric } from "./proof-grader.ts";

/**
 * horizon-10u: tasks that may be unsolvable as stated. The executor either submits a solution
 * (submit_answer) or declares the task unsolvable (declare_unsolvable) with a kind, a
 * justification and evidence. Whether a task is solvable, and which kinds are accepted, lives
 * only in `<secretDir>/<id>.json` ({kind: "solvability"}); every task also has
 * `<rubricDir>/<id>.json` (neutral where no text argument is needed), so the files do not tell
 * which is which.
 *
 * Decision. Solvable: an answer must pass the exact check; a declaration fails. Unsolvable: an
 * answer fails; a declaration needs an accepted kind, and its evidence must pass the check for
 * that kind — two scenarios checked by machine (underdetermined), a set of conditions checked
 * unsatisfiable by exhaustive search (contradictory), or the rubric grader on the justification
 * (impossible / open / infeasible). The grader is asked for every text-kind declaration, so its
 * timing depends on the submission only. The executor hears only 合格 / 不合格, or what it has
 * not submitted yet.
 */
export const UNSOLVABLE_KINDS = [
	"contradictory",
	"underdetermined",
	"impossible",
	"open",
	"infeasible",
] as const;
export type UnsolvableKind = (typeof UNSOLVABLE_KINDS)[number];
const TEXT_KINDS: readonly UnsolvableKind[] = [
	"impossible",
	"open",
	"infeasible",
];

/** Unknowns are non-negative integers; each fact is Σ coeff·var (= or <) rhs. */
export interface LinearModel {
	readonly type: "linear";
	readonly vars: readonly string[];
	readonly facts: readonly {
		readonly id: string;
		readonly terms: Readonly<Record<string, number>>;
		readonly op: "=" | "<";
		readonly rhs: number;
	}[];
	/** The unknown the question asks for. */
	readonly target: string;
}

export type ScheduleConstraint =
	| {
			readonly id: string;
			readonly kind: "not_slot";
			readonly a: string;
			readonly slot: number;
	  }
	| {
			readonly id: string;
			readonly kind: "slot_at_most";
			readonly a: string;
			readonly slot: number;
	  }
	| {
			readonly id: string;
			readonly kind: "slot_at_least";
			readonly a: string;
			readonly slot: number;
	  }
	| {
			readonly id: string;
			readonly kind: "not_adjacent";
			readonly a: string;
			readonly b: string;
	  }
	| {
			readonly id: string;
			readonly kind: "right_after";
			readonly a: string;
			readonly b: string;
	  }
	| {
			readonly id: string;
			readonly kind: "before";
			readonly a: string;
			readonly b: string;
	  };

/** Items take distinct slots 1..n. */
export interface ScheduleModel {
	readonly type: "schedule";
	readonly items: readonly string[];
	readonly constraints: readonly ScheduleConstraint[];
}

/** Straight 1×3 tiles on a rows×cols board with one cell removed (1-based). */
export interface TilingModel {
	readonly type: "tiling";
	readonly rows: number;
	readonly cols: number;
	readonly removed: readonly [number, number];
}

export type UnsolvableModel = LinearModel | ScheduleModel | TilingModel;

export interface UnsolvableSpec {
	readonly id: string;
	readonly level: 1 | 2 | 3 | 4;
	readonly title: string;
	/** The problem as posed, self-contained. */
	readonly problem: string;
	/** How the answer is written for submit_answer. */
	readonly answerFormat: string;
	readonly model: UnsolvableModel;
	readonly rubricSize: number;
	readonly traps: readonly string[];
}

export const UNSOLVABLE_PASS = "合格";
export const UNSOLVABLE_FAIL = "不合格";
const CRITERION = "answered-or-declared";
const MAX_TEXT = 32_000;

// ---------------------------------------------------------------- checks (pure)

type Assignment = Record<string, number>;

function parseScenario(
	value: unknown,
	names: readonly string[],
): Assignment | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const keys = Object.keys(value);
	if (keys.length !== names.length || !names.every((n) => keys.includes(n)))
		return null;
	const out: Assignment = {};
	for (const n of names) {
		const v = (value as Record<string, unknown>)[n];
		if (typeof v !== "number" || !Number.isSafeInteger(v)) return null;
		out[n] = v;
	}
	return out;
}

export function linearHolds(model: LinearModel, x: Assignment): boolean {
	if (!model.vars.every((v) => (x[v] ?? -1) >= 0)) return false;
	return model.facts.every((f) => {
		const lhs = Object.entries(f.terms).reduce(
			(s, [v, c]) => s + c * (x[v] ?? 0),
			0,
		);
		return f.op === "=" ? lhs === f.rhs : lhs < f.rhs;
	});
}

export function scheduleHolds(
	c: ScheduleConstraint,
	slot: Readonly<Record<string, number>>,
): boolean {
	const a = slot[c.a]!;
	switch (c.kind) {
		case "not_slot":
			return a !== c.slot;
		case "slot_at_most":
			return a <= c.slot;
		case "slot_at_least":
			return a >= c.slot;
		case "not_adjacent":
			return Math.abs(a - slot[c.b]!) !== 1;
		case "right_after":
			return a === slot[c.b]! + 1;
		case "before":
			return a < slot[c.b]!;
	}
}

function* permutations(n: number): Generator<number[]> {
	const p = Array.from({ length: n }, (_, i) => i + 1);
	function* rec(k: number): Generator<number[]> {
		if (k === n) {
			yield [...p];
			return;
		}
		for (let i = k; i < n; i++) {
			[p[k], p[i]] = [p[i]!, p[k]!];
			yield* rec(k + 1);
			[p[k], p[i]] = [p[i]!, p[k]!];
		}
	}
	yield* rec(0);
}

/** Whether the given constraints admit a schedule (exhaustive). */
export function scheduleSatisfiable(
	model: ScheduleModel,
	constraints: readonly ScheduleConstraint[],
): boolean {
	for (const p of permutations(model.items.length)) {
		const slot = Object.fromEntries(model.items.map((it, i) => [it, p[i]!]));
		if (constraints.every((c) => scheduleHolds(c, slot))) return true;
	}
	return false;
}

/** "B,D,A,..." — items in slot order. */
export function parseSchedule(
	model: ScheduleModel,
	text: string,
): Record<string, number> | null {
	const names = text
		.split(/[,、\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (names.length !== model.items.length) return null;
	if (new Set(names).size !== names.length) return null;
	if (!names.every((n) => model.items.includes(n))) return null;
	return Object.fromEntries(names.map((n, i) => [n, i + 1]));
}

export function tilingValid(model: TilingModel, text: string): boolean {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length !== model.rows) return false;
	if (!lines.every((l) => [...l].length === model.cols)) return false;
	const cells = new Map<string, [number, number][]>();
	for (let r = 0; r < model.rows; r++) {
		const row = [...lines[r]!];
		for (let c = 0; c < model.cols; c++) {
			const ch = row[c]!;
			const removed = r + 1 === model.removed[0] && c + 1 === model.removed[1];
			if (removed !== (ch === ".")) return false;
			if (removed) continue;
			cells.set(ch, [...(cells.get(ch) ?? []), [r, c]]);
		}
	}
	for (const group of cells.values()) {
		if (group.length !== 3) return false;
		const sameRow = group.every(([r]) => r === group[0]![0]);
		const sameCol = group.every(([, c]) => c === group[0]![1]);
		if (!sameRow && !sameCol) return false;
		const line = group.map(([r, c]) => (sameRow ? c : r)).sort((a, b) => a - b);
		if (line[1] !== line[0]! + 1 || line[2] !== line[0]! + 2) return false;
	}
	return true;
}

/** Shape problems of an answer (none means it may be checked). Independent of the truth. */
export function answerShapeError(
	model: UnsolvableModel,
	answer: string,
): string | null {
	const text = answer.trim();
	if (model.type === "linear")
		return /^-?\d+$/.test(text) ? null : "整数を 1 つ書いてください";
	if (model.type === "schedule")
		return parseSchedule(model, text)
			? null
			: `${model.items.join(", ")} を 1 回ずつ、カンマ区切りで並べてください`;
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return lines.length === model.rows &&
		lines.every((l) => [...l].length === model.cols)
		? null
		: `${model.rows} 行、各行 ${model.cols} 文字で書いてください`;
}

/** Exact check of a submitted solution (the truth decides separately). */
export function answerCorrect(
	model: UnsolvableModel,
	answer: string,
	expected: string | undefined,
): boolean {
	const text = answer.trim();
	if (model.type === "linear")
		return expected !== undefined && text === expected.trim();
	if (model.type === "schedule") {
		const slot = parseSchedule(model, text);
		return (
			slot !== null && model.constraints.every((c) => scheduleHolds(c, slot))
		);
	}
	return tilingValid(model, text);
}

/** Machine check of the evidence for "underdetermined" or "contradictory"; null for text kinds. */
export function evidenceHolds(
	model: UnsolvableModel,
	kind: UnsolvableKind,
	evidence: string,
): boolean | null {
	if (TEXT_KINDS.includes(kind)) return null;
	let value: unknown;
	try {
		value = JSON.parse(evidence);
	} catch {
		return false;
	}
	if (kind === "underdetermined") {
		if (model.type !== "linear") return false;
		if (!Array.isArray(value) || value.length !== 2) return false;
		const xs = value.map((v) => parseScenario(v, model.vars));
		if (xs.some((x) => x === null)) return false;
		const [x, y] = xs as Assignment[];
		return (
			linearHolds(model, x!) &&
			linearHolds(model, y!) &&
			x![model.target] !== y![model.target]
		);
	}
	// contradictory
	if (model.type !== "schedule") return false;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every((v) => typeof v === "string")
	)
		return false;
	const ids = new Set(value as string[]);
	const chosen = model.constraints.filter((c) => ids.has(c.id));
	if (chosen.length !== ids.size) return false;
	return !scheduleSatisfiable(model, chosen);
}

// ---------------------------------------------------------------- task

const COMMON = [
	"この課題は、述べられたとおりには解けないこともある（条件が互いに矛盾している、答えが一つに定まらない、求める構成が存在しない、未解決の問題である、与えられた手段では受け入れ基準を満たせない、など）。",
	"解けると判断したら submit_answer で答えを提出する。解けないと判断したら declare_unsolvable で、種類（kind）・理由（justification）・根拠（evidence）を提出する。最後に提出したもの 1 つだけが評価される（どちらの道具でも、前の提出は置き換わる）。",
	'declare_unsolvable の kind と evidence: contradictory（条件が互いに矛盾する）なら evidence に、同時には満たせない条件の id の JSON 配列（例: ["C1","C4"]）。underdetermined（答えが一つに定まらない）なら evidence に、述べられた条件をすべて満たし、問いへの答えが異なる 2 つの具体的な場合を、各未知量に値を与えた JSON オブジェクト 2 つの配列で。impossible（求めるものが存在しない）・open（未解決の問題である）・infeasible（与えられた手段では受け入れ基準を満たせない）なら、justification に完全な論証を書く（evidence は空でよい）。',
	"根拠の照合: 条件の組・具体的な場合は機械で厳密に照合し、論証は採点基準に照らして判定する。答えも機械で厳密に照合する。",
	"合格は、最後の提出が正しいときに限る（解ける課題に正しい答え、解けない課題に正しい種類と通る根拠。部分点なし）。結果は合格か不合格かだけが返り、理由は返らない。",
];

function goal(spec: UnsolvableSpec, tier: TaskContext["toolTier"]): string {
	return [
		`【問題】${spec.problem}`,
		"",
		`答えの書き方（submit_answer）: ${spec.answerFormat}`,
		"",
		...COMMON,
		"インターネットは使えません。",
		tier === 0 ? "計算機も使えません。計算・探索は手で行ってください。" : "",
	]
		.filter(Boolean)
		.join("\n");
}

interface Submission {
	readonly type: "answer" | "declaration";
	readonly answer?: string;
	readonly kind?: UnsolvableKind;
	readonly justification?: string;
	readonly evidence?: string;
}

export function defineUnsolvableTask(spec: UnsolvableSpec): EvalTask {
	return {
		id: spec.id,
		group: "E",
		level: spec.level,
		title: spec.title,
		acceptance: [
			{
				id: CRITERION,
				text: "解ける課題には正しい答え、解けない課題には正しい種類と照合を通る根拠を、最後の提出として出している",
				method: "machine",
			},
		],
		consultAnswer:
			"問題文以上の情報はありません。手元の道具だけで判断してください。",
		expected: "completed",
		traps: spec.traps,
		secretId: spec.id,
		rubricId: spec.id,
		rubricSize: spec.rubricSize,
		goal: goal(spec, 0),
		goalFor: (tier) => goal(spec, tier),
		grant: ["doc.write", "doc.read"],
		async create(directory: string, context: TaskContext) {
			const workDir = join(directory, "work");
			await mkdir(workDir, { recursive: true });
			const submissionPath = join(workDir, "submission.json");
			const readSubmission = async (): Promise<Submission | null> => {
				const text = await readFile(submissionPath, "utf8").catch(() => null);
				return text === null ? null : (JSON.parse(text) as Submission);
			};
			const gradeProof = context.grader
				? createProofGrader(context.grader)
				: null;
			const tools: ToolDef[] = [
				defineTool(
					{
						name: "submit_answer",
						description: `答えを提出する（前の提出は答え・宣言とも置き換わる）。書き方は問題文のとおり。書式だけを確かめ、正誤はここでは判定しない。`,
						permission: "doc.write",
						sideEffect: "workspace",
						properties: {
							answer: prop("string", "答え（書き方は問題文のとおり）"),
						},
						required: ["answer"],
						textField: "answer",
						fingerprintFields: ["answer"],
					},
					async (input) => {
						const answer = String(input.answer);
						const error = answerShapeError(spec.model, answer);
						if (error) return fail("invalid_answer", error);
						const s: Submission = { type: "answer", answer };
						await writeFile(submissionPath, JSON.stringify(s));
						return ok({ written: "work/submission.json", type: "answer" });
					},
				),
				defineTool(
					{
						name: "declare_unsolvable",
						description:
							"この課題は述べられたとおりには解けない、と宣言する（前の提出は答え・宣言とも置き換わる）。kind は contradictory / underdetermined / impossible / open / infeasible のいずれか。evidence の書き方は問題文の説明のとおり（contradictory は条件 id の JSON 配列、underdetermined は具体的な場合 2 つの JSON 配列、ほかは空でよい）。書式だけを確かめ、正誤はここでは判定しない。",
						permission: "doc.write",
						sideEffect: "workspace",
						properties: {
							kind: prop(
								"string",
								"contradictory / underdetermined / impossible / open / infeasible",
							),
							justification: prop(
								"string",
								"理由。impossible / open / infeasible では完全な論証（Markdown、数式は TeX）",
							),
							evidence: prop("string", "根拠（JSON または空文字列）"),
						},
						required: ["kind", "justification", "evidence"],
						textField: "justification",
						fingerprintFields: ["kind", "evidence", "justification"],
					},
					async (input) => {
						const kind = String(input.kind).trim() as UnsolvableKind;
						if (!UNSOLVABLE_KINDS.includes(kind))
							return fail(
								"invalid_kind",
								`kind は ${UNSOLVABLE_KINDS.join(" / ")} のいずれかです`,
							);
						const justification = String(input.justification);
						const evidence = String(input.evidence ?? "");
						if (!justification.trim())
							return fail("missing_justification", "justification が空です");
						if (justification.length + evidence.length > MAX_TEXT)
							return fail("too_large", `合わせて ${MAX_TEXT} 文字までです`);
						if (!TEXT_KINDS.includes(kind)) {
							try {
								JSON.parse(evidence);
							} catch {
								return fail(
									"invalid_evidence",
									"evidence を JSON で書いてください",
								);
							}
						}
						const s: Submission = {
							type: "declaration",
							kind,
							justification,
							evidence,
						};
						await writeFile(submissionPath, JSON.stringify(s));
						return ok({
							written: "work/submission.json",
							type: "declaration",
							kind,
						});
					},
				),
				defineTool(
					{
						name: "read_submission",
						description: "今の提出内容を読む。",
						permission: "doc.read",
						readsWorkspace: true,
						readsBack: true,
					},
					async () =>
						ok({ submission: ((await readSubmission()) ?? null) as never }),
				),
			];

			let diagnostics: TaskDiagnostics = { graderVerdict: null };
			async function decide(signal: AbortSignal): Promise<CriterionResult> {
				diagnostics = { graderVerdict: null };
				const s = await readSubmission();
				if (s === null)
					return criterion(CRITERION, false, "まだ何も提出されていません");
				if (!context.secretDir || !context.rubricDir || !gradeProof)
					return criterion(CRITERION, false, "照合の準備がありません");
				const secret = await loadSecret(context.secretDir, spec.id);
				if (secret.kind !== "solvability")
					return criterion(CRITERION, false, "照合の準備がありません");
				const verdict = (passed: boolean, assurance: "exact" | "model") =>
					criterion(
						CRITERION,
						passed,
						passed ? UNSOLVABLE_PASS : UNSOLVABLE_FAIL,
						assurance,
					);
				if (s.type === "answer") {
					const right = answerCorrect(
						spec.model,
						s.answer ?? "",
						secret.answer,
					);
					diagnostics = { graderVerdict: null, answerCorrect: right };
					return verdict(secret.solvable && right, "exact");
				}
				const kind = s.kind!;
				const accepted = !secret.solvable && secret.kinds.includes(kind);
				const machine = evidenceHolds(spec.model, kind, s.evidence ?? "");
				if (machine !== null) return verdict(accepted && machine, "exact");
				// Text kinds: always graded (same timing whatever the truth); ignored unless accepted.
				const rubric = await loadRubric(context.rubricDir, spec.id);
				const { decision } = await gradeProof({
					statement: `${spec.problem}\n\n【提出者の主張】この課題は述べられたとおりには解けない（種類: ${kind}）。`,
					rubric,
					proof: [
						s.justification ?? "",
						s.evidence ? `\n\n【根拠】\n${s.evidence}` : "",
					].join(""),
					signal,
				});
				diagnostics = { graderVerdict: decision.pass ? "pass" : "fail" };
				return verdict(accepted && decision.pass, "model");
			}

			return {
				tools: createToolPort(tools),
				workspace: createDirWorkspace({ directory, workDir }),
				acceptance: {
					verify: async (signal: AbortSignal) => [await decide(signal)],
				},
				diagnostics: () => diagnostics,
				async outcomeFacts(): Promise<OutcomeFacts> {
					if (!context.secretDir) throw new Error("no secret dir");
					const secret = await loadSecret(context.secretDir, spec.id);
					if (secret.kind !== "solvability")
						throw new Error("not a solvability secret");
					const s = await readSubmission();
					return {
						solvable: secret.solvable,
						submitted: s === null ? "none" : s.type,
					};
				},
				async dispose() {},
			};
		},
	} satisfies EvalTask;
}
