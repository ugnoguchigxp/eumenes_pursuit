import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject } from "../../src/contracts/index.ts";
import { exists } from "./fs-util.ts";
import { defineTool, ok, type ToolDef } from "./tool-port.ts";

export const ANSWER_FILE = "answer.json";
const MAX_ANSWER_BYTES = 8192;

export interface SubmitAnswerOptions {
	readonly workDir: string;
	readonly description: string;
	/** The answer fields; the input object itself becomes answer.json. */
	readonly properties: Record<string, JsonObject>;
	readonly required: readonly string[];
}

export function submitAnswerTool(options: SubmitAnswerOptions): ToolDef {
	return defineTool(
		{
			name: "submit_answer",
			description: options.description,
			permission: "answer.write",
			sideEffect: "workspace",
			properties: options.properties,
			required: options.required,
		},
		async (input) => {
			const text = `${JSON.stringify(input, null, 2)}\n`;
			const bytes = Buffer.byteLength(text);
			if (bytes > MAX_ANSWER_BYTES) {
				return {
					status: "error",
					errorCode: "too_large",
					output: {
						message: `answer is larger than ${MAX_ANSWER_BYTES} bytes`,
					},
					refs: [],
				};
			}
			await mkdir(options.workDir, { recursive: true });
			await writeFile(join(options.workDir, ANSWER_FILE), text);
			return ok({ written: `work/${ANSWER_FILE}`, bytes }, [
				{ kind: "artifact", uri: `work/${ANSWER_FILE}` },
			]);
		},
	);
}

export type AnswerRead =
	| { readonly state: "missing" }
	| { readonly state: "invalid" }
	| { readonly state: "ok"; readonly value: JsonObject };

export async function readAnswer(workDir: string): Promise<AnswerRead> {
	const path = join(workDir, ANSWER_FILE);
	if (!(await exists(path))) return { state: "missing" };
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return { state: "ok", value: parsed as JsonObject };
		}
	} catch {
		// falls through
	}
	return { state: "invalid" };
}
