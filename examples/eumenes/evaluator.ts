import { z } from "zod";
import type { LlmPort, ToolDescriptor } from "../../src/index.ts";
import type { ResearchDraft } from "./contracts.ts";
import { hash } from "./hash.ts";
import type { Document } from "./repository.ts";

export const reportReviewInput = z.strictObject({
	question: z.string().trim().min(1).max(800),
});
export const reportReviewTool = {
	name: "report_review",
	description:
		"保存した報告と引用本文を独立したEvaluatorに照合させる。重要な解釈・例外・資料間の矛盾や必須条件の漏れが結論を変え得るとき、下書きを保存して具体的な確認事項をquestionに指定する。指摘は原資料で確かめ、必要な修正に使う。completedはレビュー処理の完了を表し、報告の更新は別途保存する。同じ報告で同じ問いを繰り返さない。",
	inputSchema: z
		.record(z.string(), z.json())
		.parse(z.toJSONSchema(reportReviewInput)),
	permission: "research",
	sideEffect: "none",
	readsWorkspace: true,
	acceptanceEvidence: true,
} satisfies ToolDescriptor;

const usageSchema = z.object({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
});
const resultSchema = z.looseObject({
	status: z.enum(["completed", "incomplete", "failed", "cancelled", "expired"]),
	findings: z.array(z.unknown()),
	issues: z.array(z.looseObject({ code: z.string() })),
	durationMs: z.number(),
	model: z.string().optional(),
	usage: usageSchema.optional(),
});

export interface EvaluationModel {
	complete(
		request: {
			system: string;
			prompt: string;
			outputSchema: z.core.JSONSchema.JSONSchema;
			maxOutputTokens: number;
		},
		signal: AbortSignal,
	): Promise<{
		text: string;
		model: string;
		usage?: z.infer<typeof usageSchema>;
	}>;
}

export function evaluatorModel(port: LlmPort): EvaluationModel {
	return {
		async complete({ system, prompt, outputSchema, maxOutputTokens }, signal) {
			const result = await port.complete(
				{
					purpose: "grade",
					system,
					prompt,
					maxOutputTokens,
					schema: z.fromJSONSchema(outputSchema),
				},
				signal,
			);
			return {
				text: JSON.stringify(result.value),
				model: result.model,
				usage: {
					inputTokens: result.inputTokens ?? undefined,
					outputTokens: result.outputTokens ?? undefined,
				},
			};
		},
	};
}

export async function reviewReport(
	input: {
		pursuitId: string;
		request: string;
		report: ResearchDraft;
		documents: readonly Document[];
		question?: string;
	},
	model: EvaluationModel,
	signal: AbortSignal,
) {
	// The 0.1.0 tarball exports Bun source with its own TS settings and no
	// declarations. Load it only at runtime and validate the returned receipt.
	const evaluator: {
		targetDigests(target: object): { digest: string };
		evaluate(
			input: unknown,
			options: {
				model: EvaluationModel;
				signal: AbortSignal;
				selection: object;
			},
		): Promise<unknown>;
	} = require("eumenes-evaluator");
	const { pursuitId, request, report, question } = input;
	const citedIds = [
		...new Set(report.claims.flatMap((claim) => claim.evidence)),
	];
	const cited = new Set(citedIds);
	const documents = input.documents.filter((doc) => cited.has(doc.id));
	const version = hash({ request, report, documents, question });
	const snapshot = {
		kind: "workflow",
		id: pursuitId,
		version,
		document: { report, ...(question ? { reviewQuestion: question } : {}) },
	} as const;
	const { digest } = evaluator.targetDigests(snapshot);
	const evidence = documents.map((doc) => ({
		kind: "json",
		id: doc.id,
		version,
		clipped: !!doc.truncated,
		document: { url: doc.url, title: doc.title, text: doc.text },
	}));
	const evaluation = {
		contractVersion: 1,
		evaluationId: pursuitId + ":report",
		rubric: { id: "workflow-correctness", version: 1 },
		target: { ...snapshot, digest },
		scope: ["workflow", ...citedIds],
		evidence,
		originalRequest: request,
		conditions: { state: "none" },
		limits: {
			timeoutMs: 120_000,
			maxInputBytes: 128_000,
			maxOutputTokens: 4096,
		},
	};
	const result = await evaluator.evaluate(evaluation, {
		model,
		signal,
		selection: {
			version: 1,
			targetId: pursuitId,
			targetVersion: version,
			targetDigest: digest,
			include: [{ kind: "pointer", pointer: "" }],
			evidence: { initial: citedIds, required: citedIds },
			focus: question
				? "これは最終提出前の下書きの内容点検です。reviewQuestion を優先し、元依頼と引用本文に基づいて、事実、適用範囲、例外、出典、必須項目の具体的な誤りや不足を指摘してください。主根拠には報告の位置を示し、関連する取得本文の位置を引用してください。今回行っている点検や提出を待つ状態、completion が incomplete であること自体は指摘の根拠にしません。渡された資料の範囲を超える実行の有無は推定しないでください。"
				: "保存済みの調査報告を元依頼と照合してください。主張が引用した取得本文に裏づけられているか、未確認事項が明示されているか、完了の申告が妥当かを確認してください。指摘の主根拠には報告の位置を示し、必要に応じて取得本文の位置を引用してください。",
		},
	});
	return resultSchema.parse(result);
}
