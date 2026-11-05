import type { AcceptancePort, ToolPort } from "../src/contracts/index.ts";

/** Values that must never reach a model or the ledger, even if task code reads them. */
export function secretValues(
	env: Record<string, string | undefined>,
): string[] {
	return [
		"ANTHROPIC_API_KEY",
		"CLAUDE_API_KEY",
		"OPENAI_API_KEY",
		"OPEN_AI_API_KEY",
		"LARM_API_TOKEN",
	]
		.map((key) => env[key])
		.filter((v): v is string => typeof v === "string" && v.length >= 8);
}

function scrub(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) out = out.split(secret).join("<redacted>");
	return out;
}

export function redactTools(
	tools: ToolPort,
	secrets: readonly string[],
): ToolPort {
	return {
		list: () => tools.list(),
		async invoke(call, signal) {
			const outcome = await tools.invoke(call, signal);
			return JSON.parse(
				scrub(JSON.stringify(outcome), secrets),
			) as typeof outcome;
		},
	};
}

export function redactAcceptance(
	acceptance: AcceptancePort,
	secrets: readonly string[],
): AcceptancePort {
	return {
		async verify(signal) {
			const results = await acceptance.verify(signal);
			return results.map(
				(r) => JSON.parse(scrub(JSON.stringify(r), secrets)) as typeof r,
			);
		},
	};
}
