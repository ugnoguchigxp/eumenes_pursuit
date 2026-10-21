import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CriterionResult } from "../../../src/contracts/index.ts";
import type { EvalTask, TaskContext } from "../../contracts.ts";
import {
	constructionShapeError,
	type DiscoveryKind,
	discoveryExpressionError,
	discoveryNames,
	runDiscovery,
} from "../../tools/discovery.ts";
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

/**
 * Discovery tasks: the answer is not a known result, and the author computed it privately.
 * The expected value lives only in `<TaskContext.secretDir>/<id>.json` (outside the repository),
 * read by the host when checking. The executor learns pass/fail and a short reason, never the value.
 */
export interface DiscoverySpec {
	readonly id: string;
	readonly level: 1 | 2 | 3 | 4;
	readonly title: string;
	readonly statement: string;
	readonly kind: DiscoveryKind;
	/** Construction tasks only: board size and the rule name in eval/tools/discovery.py. */
	readonly board?: {
		readonly rows: number;
		readonly cols: number;
		readonly rule: "o1d1" | "king2";
	};
	readonly traps: readonly string[];
}

export const discoverySecretSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		id: z.string(),
		kind: z.literal("integer"),
		value: z.string().regex(/^-?\d+$/),
	}),
	z.strictObject({
		id: z.string(),
		kind: z.literal("formula"),
		values: z.record(z.string().regex(/^\d+$/), z.string().regex(/^-?\d+$/)),
	}),
	z.strictObject({
		id: z.string(),
		kind: z.literal("series"),
		coefficients: z.array(z.string().regex(/^-?\d+$/)).min(5),
	}),
	z.strictObject({
		id: z.string(),
		kind: z.literal("construction"),
		optimum: z.number().int().nonnegative(),
	}),
]);
export type DiscoverySecret = z.infer<typeof discoverySecretSchema>;

export async function loadSecret(
	dir: string,
	id: string,
): Promise<DiscoverySecret> {
	if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`secret_id_invalid:${id}`);
	const secret = discoverySecretSchema.parse(
		JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")),
	);
	if (secret.id !== id) throw new Error(`secret_id_mismatch:${id}`);
	return secret;
}

function rules(spec: DiscoverySpec): string[] {
	const out = [
		"インターネットも計算機も使えません。計算・探索は手で行ってください。",
	];
	if (spec.kind === "construction")
		out.push(
			`答えは submit_construction で提出する: grid に盤（${spec.board!.rows} 行、各行 ${spec.board!.cols} 文字、印は #、空きは .、行は改行で区切る）、count に印の数。`,
			"合格は、配置が条件を満たし、かつ印の数が真の最大値に等しいときに限る（部分点なし）。",
		);
	else {
		const names = discoveryNames[spec.kind];
		out.push(
			`答えは submit_answer で ASCII の式として提出する（使える記号: 数字、+ - * / ^、括弧${names.length ? `、${names.join("、")}` : ""}）。`,
			"合格は、提出した答えが正しいときに限る（部分点なし）。",
		);
	}
	return out;
}

function goal(spec: DiscoverySpec): string {
	return [`【問題】${spec.statement}`, "", ...rules(spec)].join("\n");
}

export function defineDiscoveryTask(spec: DiscoverySpec): EvalTask {
	if ((spec.kind === "construction") !== !!spec.board)
		throw new Error(`discovery_board_mismatch:${spec.id}`);
	const acceptance = [
		{
			id: "answer-correct",
			text:
				spec.kind === "construction"
					? "提出した配置が条件を満たし、印の数が最大値に等しい（機械で照合）"
					: "提出した答えが正しい（機械で照合）",
			method: "machine" as const,
		},
	];
	return {
		id: spec.id,
		group: "E",
		level: spec.level,
		title: spec.title,
		acceptance,
		consultAnswer:
			"問題文以上の情報はありません。手元の道具だけで解いてください。解けない場合はその旨を報告してください。",
		expected: "completed",
		traps: spec.traps,
		secretId: spec.id,
		goal: goal(spec),
		goalFor: () => goal(spec),
		grant: ["doc.write", "doc.read"],
		async create(directory: string, context: TaskContext) {
			const workDir = join(directory, "work");
			await mkdir(workDir, { recursive: true });
			const answerPath = join(workDir, "answer.json");
			const tools: ToolDef[] = [];
			if (spec.kind === "construction") {
				const board = spec.board!;
				tools.push(
					defineTool(
						{
							name: "submit_construction",
							description: `配置を提出する（前の提出は置き換わる）。grid は ${board.rows} 行 × ${board.cols} 文字（# と .）、count は印の数。形だけを確かめ、条件と最大性はここでは判定しない。`,
							permission: "doc.write",
							sideEffect: "workspace",
							properties: {
								grid: prop("string", "盤（行を改行で区切る）"),
								count: prop("integer", "印の数"),
							},
							textField: "grid",
							required: ["grid", "count"],
							fingerprintFields: ["grid", "count"],
						},
						async (input) => {
							const grid = String(input.grid);
							const error = constructionShapeError(
								grid,
								board.rows,
								board.cols,
							);
							if (error) return fail("invalid_construction", error);
							const count = Number(input.count);
							if (!Number.isInteger(count) || count < 0)
								return fail("invalid_count", "count は 0 以上の整数です");
							await writeFile(answerPath, JSON.stringify({ grid, count }));
							return ok({ written: "work/answer.json", count });
						},
					),
				);
			} else {
				const kind = spec.kind;
				tools.push(
					defineTool(
						{
							name: "submit_answer",
							description: `答えを ASCII の式で提出する（前の提出は置き換わる）。使える名前: ${discoveryNames[kind].join(", ") || "なし（数字と演算子だけ）"}。正誤はここでは判定しない。`,
							permission: "doc.write",
							sideEffect: "workspace",
							properties: { expression: prop("string", "答えの式") },
							required: ["expression"],
							fingerprintFields: ["expression"],
						},
						async (input) => {
							const expression = String(input.expression).trim();
							const error = discoveryExpressionError(expression, kind);
							if (error) return fail("invalid_expression", error);
							await writeFile(answerPath, JSON.stringify({ expression }));
							return ok({ written: "work/answer.json" });
						},
					),
				);
			}
			tools.push(
				defineTool(
					{
						name: "read_submission",
						description: "今の提出内容を読む。",
						permission: "doc.read",
						readsWorkspace: true,
						readsBack: true,
					},
					async () => {
						const text = await readFile(answerPath, "utf8").catch(() => null);
						return text === null
							? fail("not_found", "まだ提出していません")
							: ok(JSON.parse(text));
					},
				),
			);

			async function verify(): Promise<CriterionResult[]> {
				const id = "answer-correct";
				const text = await readFile(answerPath, "utf8").catch(() => null);
				if (text === null) return [criterion(id, false, "未提出")];
				if (!context.secretDir)
					return [criterion(id, false, "照合用データがありません")];
				const secret = await loadSecret(context.secretDir, spec.id);
				if (secret.kind !== spec.kind)
					return [criterion(id, false, "照合用データの種類が違います")];
				const submission = JSON.parse(text) as Record<string, unknown>;
				if (
					spec.kind !== "construction" &&
					discoveryExpressionError(
						String(submission.expression ?? ""),
						spec.kind,
					)
				)
					return [criterion(id, false, "式が不正です")];
				const { id: _id, kind: _kind, ...data } = secret;
				const r = await runDiscovery({
					kind: spec.kind,
					submission,
					...(spec.board ? { spec: { ...spec.board } } : {}),
					secret: data,
				});
				// Short reason only; never the expected value.
				return [criterion(id, r.ok, r.reason)];
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
