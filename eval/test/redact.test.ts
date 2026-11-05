import { expect, test } from "bun:test";
import { redactAcceptance, redactTools, secretValues } from "../redact.ts";
test("both providers and aliases are scrubbed from every tool and verifier text field", async () => {
	const secrets = secretValues({
		CLAUDE_API_KEY: "fixture-claude-secret",
		OPEN_AI_API_KEY: "fixture-openai-secret",
	});
	expect(secrets).toHaveLength(2);
	const secret = secrets.join(" ");
	const tools = redactTools(
		{
			list: () => [],
			invoke: async () => ({
				status: "ok",
				output: secret,
				refs: [{ kind: "source", uri: secret, note: secret }],
				unclipped: [secret],
				findings: [
					{ kind: "observation", statement: secret, assurance: "exact" },
				],
			}),
		},
		secrets,
	);
	const acceptance = redactAcceptance(
		{
			verify: async () => [
				{
					id: "a",
					passed: false,
					evidence: secret,
					findings: [
						{ kind: "observation", statement: secret, assurance: "exact" },
					],
				},
			],
		},
		secrets,
	);
	for (const result of [
		await tools.invoke(
			{ tool: "fixture", input: {} },
			new AbortController().signal,
		),
		await acceptance.verify(new AbortController().signal),
	]) {
		const text = JSON.stringify(result);
		for (const s of secrets) expect(text).not.toContain(s);
		expect(text).toContain("<redacted>");
	}
});
