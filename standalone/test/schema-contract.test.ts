import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zodTextFormat } from "openai/helpers/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fixture } from "../../test/fixtures/crash-runner.ts";
import { startInput } from "../../test/support.ts";
import {
	planRequest,
	hypothesisRequest,
	proposalRequest,
	reviewRequest,
} from "../../src/domains/generation/prompts.ts";
import { directStepSchema } from "../../eval/direct.ts";

test("real engine schemas in both baseline and full research conditions compile for both provider contracts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "schema-contract-"));
	const f = fixture(":memory:", join(dir, "effects"), null);
	try {
		const { pursuitId: id } = await f.engine.start(startInput(), "schemas");
		await f.engine.step(id, f.runtime, AbortSignal.timeout(1000));
		await f.engine.step(id, f.runtime, AbortSignal.timeout(1000));
		const base = (await f.engine.view(id))!;
		for (const full of [false, true]) {
			const view = {
				...base,
				input: {
					...base.input,
					conditions: {
						...base.input.conditions,
						...(full
							? {
									findings: "verified" as const,
									selfCheck: "parts" as const,
									prediction: "falsifiable" as const,
									completionCheck: "acceptance" as const,
									claimFeedback: "verdict" as const,
									attemptCount: "mutating" as const,
								}
							: {}),
					},
				},
			};
			const tools = f.runtime.tools.list();
			for (const request of [
				planRequest({ view, tools, direction: null }),
				hypothesisRequest({ view, tools }),
				proposalRequest({ view, tools, feedback: null }),
				reviewRequest({ view, reason: "fixture", signals: [], tools }),
			]) {
				expect(zodTextFormat(request.schema, "result").type).toBe(
					"json_schema",
				);
				expect(zodOutputFormat(request.schema).type).toBe("json_schema");
			}
		}
		expect(zodTextFormat(directStepSchema, "result").type).toBe("json_schema");
	} finally {
		f.store.close();
		await rm(dir, { recursive: true, force: true });
	}
});
