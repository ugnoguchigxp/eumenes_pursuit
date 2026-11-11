import { z } from "zod";
import type { LlmPort } from "../../src/index.ts";
import type { ResearchDraft } from "./contracts.ts";
import { hash } from "./hash.ts";
import type { Document } from "./repository.ts";

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
	const { pursuitId, request, report } = input;
	const citedIds = [
		...new Set(report.claims.flatMap((claim) => claim.evidence)),
	];
	const cited = new Set(citedIds);
	const documents = input.documents.filter((doc) => cited.has(doc.id));
	const version = hash({ request, report, documents });
	const snapshot = {
		kind: "workflow",
		id: pursuitId,
		version,
		document: { report },
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
			focus:
				"保存済みの調査報告を元依頼と照合してください。主張が引用した取得本文に裏づけられているか、未確認事項が明示されているか、完了の申告が妥当かを確認してください。指摘の主根拠には報告の位置を示し、必要に応じて取得本文の位置を引用してください。",
		},
	});
	return resultSchema.parse(result);
}
