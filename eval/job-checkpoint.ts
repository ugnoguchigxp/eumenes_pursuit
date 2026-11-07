import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { UsageScope } from "../standalone/usage.ts";
import { selectionSchema } from "./adaptive.ts";

const checkpointSchema = z.strictObject({
	format: z.literal(1),
	key: z.string(),
	configId: z.string(),
	pursuitId: z.string(),
	directory: z.string(),
	started: z.number(),
	scope: z.strictObject({
		runId: z.string(),
		configId: z.string(),
		jobId: z.string(),
		pursuitId: z.string().nullable(),
		budgetId: z.string().optional(),
	}),
	selection: selectionSchema.nullable(),
	selectedCondition: z.string(),
	paused: z.boolean(),
	pauseStartedAt: z.number().nullable(),
	pausedMs: z.number().nonnegative(),
	restarts: z.int().nonnegative(),
	status: z.enum(["active", "finished"]),
});
export type JobCheckpoint = z.infer<typeof checkpointSchema> & {
	scope: UsageScope;
};

export function readCheckpoint(
	path: string,
	key: string,
	configId: string,
): JobCheckpoint | null {
	if (!existsSync(path)) return null;
	const saved = checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")));
	if (saved.key !== key || saved.configId !== configId)
		throw new Error("checkpoint_configuration_mismatch");
	const { budgetId, ...scope } = saved.scope;
	return {
		...saved,
		scope: { ...scope, ...(budgetId === undefined ? {} : { budgetId }) },
	};
}
export function writeCheckpoint(path: string, value: JobCheckpoint) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	writeFileSync(
		temporary,
		JSON.stringify(checkpointSchema.parse(value)) + "\n",
	);
	renameSync(temporary, path);
}
