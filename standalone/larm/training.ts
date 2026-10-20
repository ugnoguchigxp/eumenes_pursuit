import { z } from "zod";
import { type Control, LarmControlError } from "./control.ts";

/**
 * Thin client for the LARM decision training API (Control Bearer + Idempotency-Key).
 * Paths come from the Provider description of the decision.general catalog entry.
 * The response shapes of dataset/job/adapter calls are not yet verified live; ids are
 * read leniently (`id` / `datasetId` / `jobId`) and other fields are passed through.
 */

export interface TrainingQuestionSet {
	readonly id: string;
	readonly version: number;
	readonly questions: Readonly<Record<string, unknown>>;
}

export interface StartTrainingInput {
	/** The base model discovered from the catalog (never hardcoded). */
	readonly model: string;
	readonly datasetId: string;
	readonly questionSet: TrainingQuestionSet;
}

export type JsonRecord = Record<string, unknown>;

export interface TrainingClient {
	registerDataset(jsonl: string, idempotencyKey?: string): Promise<string>;
	startTraining(
		input: StartTrainingInput,
		idempotencyKey?: string,
	): Promise<string>;
	getJob(jobId: string): Promise<JsonRecord>;
	listAdapters(): Promise<JsonRecord>;
	deleteAdapter(
		id: string,
		version: number,
		idempotencyKey?: string,
	): Promise<void>;
	deleteDataset(id: string, idempotencyKey?: string): Promise<void>;
}

const recordSchema = z.record(z.string(), z.unknown());

function pickId(body: unknown, keys: readonly string[]): string {
	const parsed = recordSchema.safeParse(body);
	if (!parsed.success) throw new LarmControlError("larm_invalid_contract");
	for (const key of keys) {
		const value = parsed.data[key];
		if (typeof value === "string" && value.length > 0 && value.length <= 200)
			return value;
	}
	throw new LarmControlError("larm_invalid_contract");
}

function asRecord(body: unknown): JsonRecord {
	const parsed = recordSchema.safeParse(body);
	if (!parsed.success) throw new LarmControlError("larm_invalid_contract");
	return parsed.data;
}

const seg = encodeURIComponent;

export function createTrainingClient(control: Control): TrainingClient {
	return {
		async registerDataset(jsonl, idempotencyKey = crypto.randomUUID()) {
			const body = await control.json("/v1/decision/datasets", {
				method: "POST",
				text: jsonl,
				contentType: "application/x-ndjson",
				idempotencyKey,
				accepted: [200, 201, 202],
				timeoutMs: 120_000,
			});
			return pickId(body, ["id", "datasetId"]);
		},
		async startTraining(input, idempotencyKey = crypto.randomUUID()) {
			const body = await control.json("/v1/decision/training-jobs", {
				method: "POST",
				json: {
					model: input.model,
					datasetId: input.datasetId,
					questionSet: input.questionSet,
				},
				idempotencyKey,
				accepted: [200, 201, 202],
			});
			return pickId(body, ["jobId", "id"]);
		},
		async getJob(jobId) {
			return asRecord(
				await control.json(`/v1/decision/training-jobs/${seg(jobId)}`),
			);
		},
		async listAdapters() {
			return asRecord(await control.json("/v1/decision/adapters"));
		},
		async deleteAdapter(id, version, idempotencyKey = crypto.randomUUID()) {
			await control.request(
				`/v1/decision/adapters/${seg(id)}/versions/${version}`,
				{
					method: "DELETE",
					idempotencyKey,
					accepted: [200, 204],
				},
			);
		},
		async deleteDataset(id, idempotencyKey = crypto.randomUUID()) {
			await control.request(`/v1/decision/datasets/${seg(id)}`, {
				method: "DELETE",
				idempotencyKey,
				accepted: [200, 204],
			});
		},
	};
}
