import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CriterionResult,
	JsonObject,
} from "../../../src/contracts/index.ts";
import type { EvalTask, TaskContext } from "../../contracts.ts";
import {
	type CounterexampleFormat,
	type CounterexampleRule,
	counterexampleShapeError,
	runCounterexample,
} from "../../tools/counterexample.ts";
import { checkTex } from "../../tools/math.ts";
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
 * Hidden-truth tasks: the executor decides whether a statement is true, then proves it or gives
 * a counterexample. Whether it is true lives only in `<secretDir>/<id>.json` ({kind: "verdict",
 * truth}); every task also has `<rubricDir>/<id>.json`, the proof rubric (for a false statement a
 * neutral one, so the set of files does not tell which is which).
 *
 * Decision: verdict wrong → fail. "false" and right → the counterexample must pass the exact
 * check (counterexample.py). "true" and right → the proof must pass the rubric grader (strict, as
 * in horizon-6). The grader is asked whenever the executor claims "true" (also when the claim is
 * wrong, its answer then being ignored), so the grader's response time does not reveal the truth.
 * The executor only ever hears 合格 / 不合格, or a message about what it has not submitted yet,
 * which depends on its own submission only. Checkpoint ids are not returned: they would appear
 * only after a correct "true" verdict and so reveal the truth.
 */
export interface VerdictSpec {
	readonly id: string;
	readonly level: 1 | 2 | 3 | 4;
	readonly title: string;
	/** The claim, self-contained; phrased the same way whether or not it is true. */
	readonly claim: string;
	/** How a counterexample is written (shown for every task). */
	readonly counterexample: {
		readonly format: CounterexampleFormat;
		readonly how: string;
		readonly rule: CounterexampleRule;
	};
	/** Number of checkpoints in every external rubric of this family (uniform on purpose). */
	readonly rubricSize: number;
	readonly traps: readonly string[];
}

const MAX_DOC = 32_000;
export const VERDICT_PASS = "合格";
export const VERDICT_FAIL = "不合格";
const CRITERION = "decided-and-justified";

function statement(spec: VerdictSpec): string {
	return `次の主張が正しいかどうかを判定し、正しければ証明し、正しくなければ反例を挙げよ。\n【主張】${spec.claim}`;
}

function goal(spec: VerdictSpec, tier: TaskContext["toolTier"]): string {
	return [
		`【問題】${statement(spec)}`,
		"",
		"インターネットは使えません。",
		tier === 0 ? "計算機も使えません。計算・探索は手で行ってください。" : "",
		"submit_verdict で判定を提出する（true = 主張は正しい、false = 主張は正しくない。提出し直すと置き換わる）。",
		"true と判定した場合: 証明を write_proof で work/proof.md に書く（Markdown、数式は TeX）。証明は採点基準に照らして判定される。標準的な定理は、名前を挙げ仮定を満たすことを確かめれば引用してよい。数値計算や小さい場合の確認は証明の代わりにならない。",
		`false と判定した場合: 反例を submit_counterexample で提出する。${spec.counterexample.how}反例は機械で厳密に照合される。`,
		"合格は、判定が正しく、かつその判定に対応する提出物（証明または反例）が基準を満たすときに限る（部分点なし）。結果は合格か不合格かだけが返り、理由は返らない。",
	]
		.filter(Boolean)
		.join("\n");
}

export function defineVerdictTask(spec: VerdictSpec): EvalTask {
	return {
		id: spec.id,
		group: "E",
		level: spec.level,
		title: spec.title,
		acceptance: [
			{
				id: CRITERION,
				text: "判定が正しく、正しいと判定した場合は証明が採点基準を満たし、正しくないと判定した場合は反例が機械照合を通る",
				method: "machine",
			},
		],
		consultAnswer:
			"問題文以上の情報はありません。手元の道具だけで解いてください。解けない場合はその旨を報告してください。",
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
			const verdictPath = join(workDir, "verdict.txt");
			const proofPath = join(workDir, "proof.md");
			const counterPath = join(workDir, "counterexample.txt");
			const read = (path: string) => readFile(path, "utf8").catch(() => null);
			const gradeProof = context.grader
				? createProofGrader(context.grader)
				: null;
			const format = spec.counterexample.format;
			const tools: ToolDef[] = [
				defineTool(
					{
						name: "submit_verdict",
						description:
							"判定を提出する（前の提出は置き換わる）。true = 主張は正しい、false = 主張は正しくない。正誤はここでは判定しない。",
						permission: "doc.write",
						sideEffect: "workspace",
						properties: { verdict: prop("string", "true または false") },
						required: ["verdict"],
						fingerprintFields: ["verdict"],
					},
					async (input) => {
						const v = String(input.verdict).trim().toLowerCase();
						if (v !== "true" && v !== "false")
							return fail("invalid_verdict", "true か false を書いてください");
						await writeFile(verdictPath, v);
						return ok({ written: "work/verdict.txt", verdict: v });
					},
				),
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
						name: "check_tex",
						description:
							"work/proof.md の数式が TeX として組めるかを検査し、誤りを返す。",
						permission: "doc.read",
						readsWorkspace: true,
					},
					async () => {
						const text = await read(proofPath);
						if (text === null) return fail("not_found", "まだ書かれていません");
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
				defineTool(
					{
						name: "submit_counterexample",
						description: `反例を提出する（前の提出は置き換わる）。${spec.counterexample.how}書式だけを確かめ、反例になっているかはここでは判定しない。`,
						permission: "doc.write",
						sideEffect: "workspace",
						properties: {
							data: prop("string", "反例（書式は問題文のとおり）"),
						},
						textField: "data",
						required: ["data"],
						fingerprintFields: ["data"],
					},
					async (input) => {
						const data = String(input.data);
						const error = counterexampleShapeError(data, format);
						if (error) return fail("invalid_counterexample", error);
						await writeFile(counterPath, data);
						return ok({ written: "work/counterexample.txt" });
					},
				),
				defineTool(
					{
						name: "read_submission",
						description: "今の判定・証明・反例の提出内容を読む。",
						permission: "doc.read",
						readsWorkspace: true,
						readsBack: true,
					},
					async () =>
						ok({
							verdict: (await read(verdictPath)) ?? null,
							proof: (await read(proofPath)) ?? null,
							counterexample: (await read(counterPath)) ?? null,
						}),
				),
			];

			async function decide(signal: AbortSignal): Promise<CriterionResult> {
				const verdict = (await read(verdictPath))?.trim() ?? null;
				if (verdict === null)
					return criterion(CRITERION, false, "判定が未提出");
				if (!context.secretDir || !context.rubricDir || !gradeProof)
					return criterion(CRITERION, false, "照合の準備がありません");
				const secret = await loadSecret(context.secretDir, spec.id);
				if (secret.kind !== "verdict")
					return criterion(CRITERION, false, "照合の準備がありません");
				if (verdict === "true") {
					const proof = await read(proofPath);
					if (proof === null)
						return criterion(CRITERION, false, "証明が未提出");
					const tex = checkTex(proof);
					if (tex.errors.length || tex.segments < 3)
						return criterion(
							CRITERION,
							false,
							"証明の数式が TeX として組めないか、数式が 3 つ未満です",
						);
					const rubric = await loadRubric(context.rubricDir, spec.id);
					// Asked even when the verdict is wrong (answer ignored): same timing either way.
					const { decision } = await gradeProof({
						statement: statement(spec),
						rubric,
						proof,
						signal,
					});
					const passed = secret.truth && decision.pass;
					return criterion(
						CRITERION,
						passed,
						passed ? VERDICT_PASS : VERDICT_FAIL,
						passed ? "model" : "exact",
					);
				}
				const data = await read(counterPath);
				if (data === null) return criterion(CRITERION, false, "反例が未提出");
				if (counterexampleShapeError(data, format))
					return criterion(CRITERION, false, "反例の書式が不正です");
				if (secret.truth) return criterion(CRITERION, false, VERDICT_FAIL);
				const r = await runCounterexample({
					rule: spec.counterexample.rule,
					data,
				});
				return criterion(CRITERION, r.ok, r.ok ? VERDICT_PASS : VERDICT_FAIL);
			}

			return {
				tools: createToolPort(tools),
				workspace: createDirWorkspace({ directory, workDir }),
				acceptance: {
					verify: async (signal: AbortSignal) => [await decide(signal)],
				},
				async dispose() {},
			};
		},
	} satisfies EvalTask;
}
