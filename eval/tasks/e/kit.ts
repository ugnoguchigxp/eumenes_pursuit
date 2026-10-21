import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	CriterionResult,
	JsonObject,
} from "../../../src/contracts/index.ts";
import type { EvalTask, TaskContext } from "../../contracts.ts";
import {
	checkTex,
	expressionError,
	parseChecks,
	runMath,
} from "../../tools/math.ts";
import { clipText } from "../../tools/text.ts";
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
import { createCritic } from "./critic.ts";
import { createGrader, type Grade, type RubricItem } from "./grader.ts";
import {
	createProofGrader,
	loadRubric,
	type ProofGrade,
} from "./proof-grader.ts";

/** A written-reasoning task: a document (proof, derivation, plan) and/or a closed-form answer. */
export interface ReasoningSpec {
	readonly id: string;
	readonly domain: "math" | "physics" | "workflow";
	readonly level: 1 | 2 | 3 | 4;
	readonly title: string;
	readonly statement: string;
	/** Graded document required (proof/derivation). */
	readonly document: boolean;
	/** Numeric facts must be listed and are checked exactly. */
	readonly numericChecks: boolean;
	/** Names that may not appear in checks (e.g. pi when bounding pi). */
	readonly forbid?: readonly string[];
	readonly rubric?: readonly RubricItem[];
	/** Sketch for the grader only; never shown to the executor. */
	readonly reference?: string;
	/**
	 * Rubric kept outside the repository: `<context.rubricDir>/<rubricId>.json`, read only by
	 * the host when grading (proof-grader.ts). Use instead of `rubric`/`reference`.
	 */
	readonly rubricId?: string;
	/** Number of checkpoints in the external rubric (for partial credit in analyze). */
	readonly rubricSize?: number;
	/** Hidden closed form; the submitted expression must equal it to 50 digits. */
	readonly answer?: string;
	readonly traps: readonly string[];
}

const MAX_DOC = 32_000;
/** Closed forms of weight-6 sums run to about 300 characters; leave room for other spellings. */
const MAX_ANSWER = 600;
/** Tier 2 sees technique notes; tier 3 also sees lemma-level notes. */
const referenceDirs = {
	techniques: resolve(import.meta.dir, "reference"),
	lemmas: resolve(import.meta.dir, "reference-lemmas"),
};

function goal(spec: ReasoningSpec, tier: TaskContext["toolTier"]): string {
	const rules = [
		"インターネットは使えません。",
		tier === 0
			? "計算機も使えません。計算は手で行い、根拠を書いてください。"
			: "",
	];
	if (spec.document)
		rules.push(
			"解答は write_proof で work/proof.md に書く。Markdown で、数式は TeX（$…$ または $$…$$）で書く。",
		);
	if (spec.numericChecks)
		rules.push(
			"証明で使う数値の不等式・等式は、文書の末尾の ```checks ブロックに 1 行ずつ ASCII の式で列挙する（例: sqrt(7) > 2.645、2.645^2 < 7）。この欄は計算機で厳密に検算される。",
		);
	if (spec.answer)
		rules.push(
			"最終的な答えは submit_answer で閉じた式として提出する（ASCII: pi^4/90、zeta(3)、log(2) など）。",
		);
	return [`【問題】${spec.statement}`, "", ...rules.filter(Boolean)].join("\n");
}

function acceptance(spec: ReasoningSpec): EvalTask["acceptance"] {
	const out: { id: string; text: string; method: "machine" | "human" }[] = [];
	if (spec.document) {
		out.push({
			id: "tex-valid",
			text: "work/proof.md の数式がすべて TeX として正しく組め、数式を 3 つ以上含む",
			method: "machine",
		});
		if (spec.numericChecks)
			out.push({
				id: "checks-true",
				text: "```checks ブロックがあり、列挙した数値の主張がすべて正しい",
				method: "machine",
			});
		out.push({
			id: "proof-sound",
			text: "問題の主張そのものを、飛躍・循環なく示している（採点者が判定）",
			method: "machine",
		});
	}
	if (spec.answer)
		out.push({
			id: "answer-correct",
			text: "提出した答えが正しい値と一致する",
			method: "machine",
		});
	return out;
}

function referenceTools(dirs: readonly string[]): ToolDef[] {
	async function load() {
		const files = (
			await Promise.all(
				dirs.map(async (dir) =>
					(await readdir(dir))
						.filter((f) => f.endsWith(".md"))
						.map((f) => join(dir, f)),
				),
			)
		).flat();
		return Promise.all(
			files.map(async (f) => {
				const text = await readFile(f, "utf8");
				return {
					id: f.split("/").at(-1)!.replace(/\.md$/, ""),
					title: text.split("\n")[0]?.replace(/^#\s*/, "") ?? f,
					text,
				};
			}),
		);
	}
	const terms = (q: string) => {
		const words = q.toLowerCase().match(/[a-z0-9]+|[^\sa-z0-9]/g) ?? [];
		const cjk = q.replace(/[\sa-zA-Z0-9]/g, "");
		const bigrams = [...cjk].slice(0, -1).map((c, i) => c + cjk[i + 1]);
		return [...words.filter((w) => w.length > 1), ...bigrams];
	};
	return [
		defineTool(
			{
				name: "search_reference",
				description:
					"手元の参考資料（定理・定石のノート。問題の解答は含まない）をキーワードで検索し、上位 3 件の見出しと冒頭を返す。",
				permission: "reference.read",
				properties: { query: prop("string", "探したい内容") },
				required: ["query"],
				fingerprintFields: ["query"],
			},
			async (input) => {
				const q = terms(String(input.query));
				const scored = (await load())
					.map((d) => ({
						d,
						score: q.filter((t) => d.text.toLowerCase().includes(t)).length,
					}))
					.filter((x) => x.score > 0)
					.sort((a, b) => b.score - a.score)
					.slice(0, 3);
				return ok({
					results: scored.map(({ d }) => ({
						id: d.id,
						title: d.title,
						snippet: clipText(d.text, 300),
					})),
				});
			},
		),
		defineTool(
			{
				name: "read_reference",
				description: "参考資料を id で読む。",
				permission: "reference.read",
				properties: { id: prop("string", "search_reference が返した id") },
				required: ["id"],
				fingerprintFields: ["id"],
			},
			async (input) => {
				const doc = (await load()).find((d) => d.id === String(input.id));
				return doc
					? ok({ text: clipText(doc.text, 4000) })
					: fail("not_found", "その id の資料はありません");
			},
		),
	];
}

export function defineReasoningTask(spec: ReasoningSpec): EvalTask {
	const meta = {
		id: spec.id,
		group: "E" as const,
		level: spec.level,
		title: spec.title,
		acceptance: acceptance(spec),
		consultAnswer:
			"問題文以上の情報はありません。手元の道具だけで解いてください。解けない場合はその旨を報告してください。",
		expected: "completed" as const,
		traps: spec.traps,
		...(spec.rubric ? { rubricSize: spec.rubric.length } : {}),
		...(spec.rubricId
			? { rubricId: spec.rubricId, rubricSize: spec.rubricSize ?? 0 }
			: {}),
	};
	return {
		...meta,
		goal: goal(spec, 0),
		goalFor: (tier) => goal(spec, tier),
		grant: ["doc.write", "doc.read", "math.calc", "reference.read"],
		async create(directory, context) {
			const workDir = join(directory, "work");
			await mkdir(workDir, { recursive: true });
			const proofPath = join(workDir, "proof.md");
			const answerPath = join(workDir, "answer.txt");
			const grade: Grade | null = context.grader
				? createGrader(context.grader)
				: null;
			const gradeProof: ProofGrade | null =
				context.grader && spec.rubricId
					? createProofGrader(context.grader)
					: null;
			const read = (path: string) => readFile(path, "utf8").catch(() => null);
			const tools: ToolDef[] = [];
			if (spec.document)
				tools.push(
					defineTool(
						{
							name: "write_proof",
							description: "work/proof.md を content で丸ごと置き換える。",
							permission: "doc.write",
							sideEffect: "workspace",
							properties: {
								content: prop("string", "文書の全文（Markdown＋TeX）"),
							},
							textField: "content",
							required: ["content"],
							fingerprintFields: ["content"],
						},
						async (input) => {
							const content = String(input.content);
							if (content.length > MAX_DOC)
								return fail("too_large", `${MAX_DOC} 文字までです`);
							await writeFile(proofPath, content);
							return ok({ written: "work/proof.md", chars: content.length }, [
								{ kind: "artifact", uri: "work/proof.md" },
							]);
						},
					),
					defineTool(
						{
							name: "read_proof",
							description: "work/proof.md を読む。",
							permission: "doc.read",
							readsWorkspace: true,
							readsBack: true,
						},
						async () => {
							const text = await read(proofPath);
							return text === null
								? fail("not_found", "まだ書かれていません")
								: ok({ content: text });
						},
					),
					defineTool(
						{
							name: "check_tex",
							description:
								"work/proof.md の数式が TeX として組めるかを検査し、誤りを返す。",
							permission: "doc.read",
							readsWorkspace: true,
						},
						async () => {
							const text = await read(proofPath);
							if (text === null)
								return fail("not_found", "まだ書かれていません");
							const report = checkTex(text);
							return report.errors.length
								? {
										status: "error",
										errorCode: "tex_errors",
										output: report as unknown as JsonObject,
										refs: [],
									}
								: ok({ segments: report.segments, errors: [] });
						},
					),
				);
			if (spec.answer)
				tools.push(
					defineTool(
						{
							name: "submit_answer",
							description:
								"最終的な答え（閉じた式、ASCII）を work/answer.txt に書く。値の正誤は返さない。",
							permission: "doc.write",
							sideEffect: "workspace",
							properties: {
								expression: prop("string", "例: 3*log(2)/5 - zeta(3)/7"),
							},
							required: ["expression"],
							fingerprintFields: ["expression"],
						},
						async (input) => {
							const expression = String(input.expression).trim();
							const error = expressionError(expression, [], MAX_ANSWER);
							if (error) return fail("invalid_expression", error);
							await writeFile(answerPath, expression);
							return ok({ written: "work/answer.txt" });
						},
					),
				);
			if (context.toolTier >= 1)
				tools.push(
					defineTool(
						{
							name: "calc",
							description:
								"ASCII の式を厳密に数値評価する（最大 30 桁）。例: sqrt(7)-sqrt(3)、log(5)/3。",
							permission: "math.calc",
							properties: {
								expression: prop("string", "評価する式"),
								digits: prop("integer", "桁数（既定 20、最大 30）"),
							},
							required: ["expression"],
							fingerprintFields: ["expression", "digits"],
						},
						async (input) => {
							const expression = String(input.expression);
							const error = expressionError(expression);
							if (error) return fail("invalid_expression", error);
							const digits = Math.min(
								30,
								Math.max(5, Number(input.digits ?? 20)),
							);
							const [result] = (
								await runMath({
									items: [],
									evaluate: expression,
									evalDigits: digits,
								})
							).slice(-1);
							return result?.value
								? ok({ value: result.value })
								: fail("eval_error", result?.error ?? "評価できません");
						},
					),
				);
			if (spec.document && context.critic) {
				const critique = createCritic(context.critic);
				tools.push(
					defineTool(
						{
							name: "review_draft",
							description:
								"別の査読者が work/proof.md を読み、飛躍・誤り・根拠のない主張と、既に厳密な部分を挙げる。合否は返さない。focus に特に見てほしい箇所を書ける。",
							permission: "doc.read",
							readsWorkspace: true,
							properties: {
								focus: prop("string", "特に見てほしい箇所（任意）"),
							},
							fingerprintFields: ["focus"],
						},
						async (input, signal) => {
							const draft = await read(proofPath);
							if (draft === null)
								return fail("not_found", "まだ書かれていません");
							const result = await critique({
								statement: spec.statement,
								draft,
								focus: String(input.focus ?? ""),
								signal,
							});
							return ok(result);
						},
					),
				);
			}
			if (context.toolTier >= 2)
				tools.push(
					...referenceTools(
						context.toolTier >= 3
							? [referenceDirs.techniques, referenceDirs.lemmas]
							: [referenceDirs.techniques],
					),
				);

			/** External-rubric proofs: structured verdict, pass = no fatal error and score ≥ threshold. */
			async function proofByRubric(
				rubricId: string,
				proof: string,
				formatOk: boolean,
				signal: AbortSignal,
			): Promise<CriterionResult> {
				if (!gradeProof)
					return criterion("proof-sound", false, "採点者がいません");
				if (!context.rubricDir)
					return criterion("proof-sound", false, "採点基準がありません");
				if (!formatOk)
					return criterion(
						"proof-sound",
						false,
						"形式の基準を先に満たしてください",
					);
				const rubric = await loadRubric(context.rubricDir, rubricId);
				const { decision } = await gradeProof({
					statement: spec.statement,
					rubric,
					proof,
					signal,
				});
				// Ids and the score only: the grader's reasons would coach the executor.
				const score = `得点 ${(decision.score * 100).toFixed(0)}%`;
				const fatal = decision.fatal.length
					? `致命的: ${decision.fatal.join(", ")}; `
					: "";
				return criterion(
					"proof-sound",
					decision.pass,
					decision.pass
						? `合格（${score}）`
						: `不合格の基準: ${decision.failedCheckpoints.join(", ") || "総合"}（${fatal}${score}）`,
					"model",
				);
			}

			async function verify(signal: AbortSignal): Promise<CriterionResult[]> {
				const out: CriterionResult[] = [];
				const proof = spec.document ? await read(proofPath) : null;
				let formatOk = true;
				if (spec.document) {
					if (proof === null) {
						return acceptance(spec).map((a) =>
							criterion(a.id, false, "未提出"),
						);
					}
					const tex = checkTex(proof);
					const texOk = tex.errors.length === 0 && tex.segments >= 3;
					formatOk &&= texOk;
					out.push(
						criterion(
							"tex-valid",
							texOk,
							`segments=${tex.segments} errors=${tex.errors.length}`,
						),
					);
					if (spec.numericChecks) {
						const checks = parseChecks(proof, spec.forbid ?? []);
						let checksOk =
							checks.found &&
							checks.items.length > 0 &&
							checks.errors.length === 0;
						let checksAssurance: "exact" | "numeric" = "exact";
						let detail = !checks.found
							? "checks ブロックがありません"
							: checks.errors.slice(0, 3).join(" / ");
						if (checksOk) {
							const results = await runMath({ items: checks.items });
							const wrong = checks.items.filter((_, i) => !results[i]?.ok);
							checksOk = wrong.length === 0;
							// One numeric (tolerance-based) decision makes the whole criterion numeric.
							if (results.some((r) => r.assurance === "numeric"))
								checksAssurance = "numeric";
							detail = checksOk
								? `${checks.items.length} 件すべて正しい`
								: `誤り: ${wrong
										.map((w) => w.line)
										.slice(0, 3)
										.join(" / ")}`;
						}
						formatOk &&= checksOk;
						out.push(
							criterion(
								"checks-true",
								checksOk,
								clipText(detail, 300),
								checksAssurance,
							),
						);
					}
					if (spec.rubricId) {
						out.push(
							await proofByRubric(spec.rubricId, proof, formatOk, signal),
						);
					} else if (!formatOk || !grade || !spec.rubric) {
						out.push(
							criterion(
								"proof-sound",
								false,
								!grade
									? "採点者がいません"
									: "形式の基準を先に満たしてください",
							),
						);
					} else {
						const verdict = await grade({
							statement: spec.statement,
							rubric: spec.rubric,
							reference: spec.reference ?? "",
							proof,
							signal,
						});
						const failed = verdict.items
							.filter((i) => !i.passed)
							.map((i) => i.id);
						// Ids only: the grader's reasons would coach the executor.
						out.push(
							criterion(
								"proof-sound",
								verdict.sound,
								verdict.sound
									? "合格"
									: `不合格の基準: ${failed.join(", ") || "総合"}`,
								"model",
								verdict.lemmas
									.filter((l) => l.passed)
									.map((l) => ({
										kind: "lemma" as const,
										statement: l.statement,
										assurance: "model" as const,
									})),
							),
						);
					}
				}
				if (spec.answer) {
					const submitted = (await read(answerPath))?.trim() ?? "";
					let correct = false;
					let answerAssurance: "exact" | "numeric" = "exact";
					if (submitted && !expressionError(submitted, [], MAX_ANSWER)) {
						const [r] = await runMath({
							items: [{ line: "", lhs: submitted, op: "=", rhs: spec.answer }],
						});
						correct = r?.ok === true;
						answerAssurance = r?.assurance ?? "numeric";
					}
					out.push(
						criterion(
							"answer-correct",
							correct,
							submitted ? (correct ? "一致" : "不一致") : "未提出",
							answerAssurance,
						),
					);
				}
				return out;
			}

			return {
				tools: createToolPort(tools),
				workspace: createDirWorkspace({ directory, workDir }),
				acceptance: { verify },
				async dispose() {},
			};
		},
	} satisfies EvalTask;
}
