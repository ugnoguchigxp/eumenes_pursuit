import type {
	AcceptancePort,
	JsonValue,
	ToolPort,
} from "../src/contracts/index.ts";

/** Values that must never reach a model or the ledger, even if task code reads them. */
export function secretValues(
	env: Record<string, string | undefined>,
): string[] {
	return ["ANTHROPIC_API_KEY", "LARM_API_TOKEN"]
		.map((key) => env[key])
		.filter((v): v is string => typeof v === "string" && v.length >= 8);
}

function scrub(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) out = out.split(secret).join("<redacted>");
	return out;
}

const scrubJson = (value: JsonValue, secrets: readonly string[]): JsonValue =>
	JSON.parse(scrub(JSON.stringify(value), secrets)) as JsonValue;

export function redactTools(
	tools: ToolPort,
	secrets: readonly string[],
): ToolPort {
	return {
		list: () => tools.list(),
		async invoke(call, signal) {
			const outcome = await tools.invoke(call, signal);
			return {
				...outcome,
				output: scrubJson(outcome.output, secrets),
				// Stored in the ledger for judging refutedIf (fixes-2026-10-22-d §3.1): scrubbed too.
				...(outcome.unclipped
					? { unclipped: outcome.unclipped.map((s) => scrub(s, secrets)) }
					: {}),
			};
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
			return results.map((r) => ({
				...r,
				evidence: scrub(r.evidence, secrets),
			}));
		},
	};
}
