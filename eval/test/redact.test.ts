import { expect, test } from "bun:test";
import { redactAcceptance, redactTools, secretValues } from "../redact.ts";

test("JSON escaping cannot hide a secret from redaction in values or keys", async () => {
	const secret = 'fixture-"secret\\line\nend';
	const tools = redactTools(
		{
			list: () => [
				{
					name: "fixture",
					description: secret,
					permission: "read",
					inputSchema: { type: "object" },
					sideEffect: "none",
				},
			],
			invoke: async () => ({
				status: "ok",
				output: secret,
				refs: [],
				[secret]: secret,
			}),
		},
		[secret],
	);
	expect(tools.list()[0]?.description).toBe("<redacted>");
	const outcome = await tools.invoke(
		{ tool: "fixture", input: {} },
		new AbortController().signal,
	);
	expect(outcome.output).toBe("<redacted>");
	expect(Object.keys(outcome)).not.toContain(secret);
	const acceptance = redactAcceptance(
		{ verify: async () => [{ id: "a", passed: false, evidence: secret }] },
		[secret],
	);
	expect(
		(await acceptance.verify(new AbortController().signal))[0]?.evidence,
	).toBe("<redacted>");
});

test("tool and acceptance exceptions do not leak secrets in their message or stack", async () => {
	const secret = "fixture-exception-secret";
	const failure = Object.freeze(new Error(`failed with ${secret}`));
	const tools = redactTools(
		{
			list: () => [],
			invoke: async () => {
				throw failure;
			},
		},
		[secret],
	);
	const acceptance = redactAcceptance(
		{
			verify: async () => {
				throw failure;
			},
		},
		[secret],
	);
	for (const action of [
		() =>
			tools.invoke(
				{ tool: "fixture", input: {} },
				new AbortController().signal,
			),
		() => acceptance.verify(new AbortController().signal),
	]) {
		let error: unknown;
		try {
			await action();
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("<redacted>");
		expect((error as Error).stack).not.toContain(secret);
	}
});
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
