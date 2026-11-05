import { expect, test } from "bun:test";
import type { ToolDescriptor } from "../../src/index.ts";
import { hypothesis, plan, proposal, run, runtime } from "./harness.ts";

test("the actual reviewer receives tool capabilities, schemas and current permissions", async () => {
	const tools: ToolDescriptor[] = [
		{
			name: "lookup_reference",
			description:
				"A read-only archive of the same records, copied after publication.",
			inputSchema: { type: "object", properties: { key: { type: "string" } } },
			sideEffect: "none",
			permission: "data.read",
		},
		{
			name: "restricted_write",
			description: "An operation requiring an additional grant.",
			inputSchema: { type: "object" },
			sideEffect: "workspace",
			permission: "admin.write",
		},
	];
	const { prompts } = await run({
		reviewer: true,
		conditions: { review: true, rules: false },
		runtime: runtime({ tools }),
		script: {
			plan: [plan],
			hypothesize: [{ ...hypothesis, tools: [tools[0]!.name] }],
			propose: [proposal("step_back")],
			review: [
				{
					decision: "stop",
					reason: "fixture",
					brokenAssumption: "",
					direction: "",
				},
			],
		},
	});
	const request = prompts.find((p) => p.purpose === "review");
	expect(request).toBeDefined();
	const descriptors = request!.prompt.split("\n").flatMap((line) => {
		try {
			const value = JSON.parse(line);
			return value &&
				typeof value === "object" &&
				typeof value.name === "string"
				? [value]
				: [];
		} catch {
			return [];
		}
	});
	expect(descriptors).toEqual(
		tools.map((tool, i) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.inputSchema,
			changes_workspace: tool.sideEffect === "workspace",
			permitted: i === 0,
		})),
	);
});
