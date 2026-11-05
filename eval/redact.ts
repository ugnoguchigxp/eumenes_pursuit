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

function scrubJson<T>(value: T, secrets: readonly string[]): T {
	function visit(value: unknown): unknown {
		if (typeof value === "string") return scrub(value, secrets);
		if (Array.isArray(value)) return value.map(visit);
		if (value !== null && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [
					scrub(key, secrets),
					visit(item),
				]),
			);
		return value;
	}
	// Decode before matching: quotes, backslashes and controls have JSON escape sequences.
	return visit(JSON.parse(JSON.stringify(value))) as T;
}

export function redactError(error: unknown, secrets: readonly string[]): Error {
	const safe = new Error(
		scrub(error instanceof Error ? error.message : String(error), secrets),
	);
	if (error instanceof Error) {
		safe.name = scrub(error.name, secrets);
		if (error.stack) safe.stack = scrub(error.stack, secrets);
	}
	// Do not copy arbitrary cause/provider payloads or mutate the original exception.
	return safe;
}

export function redactTools(
	tools: ToolPort,
	secrets: readonly string[],
): ToolPort {
	return {
		list() {
			try {
				return scrubJson(tools.list(), secrets);
			} catch (error) {
				throw redactError(error, secrets);
			}
		},
		async invoke(call, signal) {
			try {
				return scrubJson(await tools.invoke(call, signal), secrets);
			} catch (error) {
				throw redactError(error, secrets);
			}
		},
	};
}

export function redactAcceptance(
	acceptance: AcceptancePort,
	secrets: readonly string[],
): AcceptancePort {
	return {
		async verify(signal) {
			try {
				return scrubJson(await acceptance.verify(signal), secrets);
			} catch (error) {
				throw redactError(error, secrets);
			}
		},
	};
}
