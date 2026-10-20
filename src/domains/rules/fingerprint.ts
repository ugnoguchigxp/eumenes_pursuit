import type {
	JsonObject,
	JsonValue,
	ToolDescriptor,
} from "../../contracts/index.ts";

/** Key-sorted JSON, so equal values always serialize identically. */
export function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
		.join(",")}}`;
}

/** Normalize text inputs so whitespace-only edits do not count as a new condition. */
function normalize(value: JsonValue): JsonValue {
	if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(normalize);
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, normalize(item)]),
	);
}

const fnvPrime = 0x100000001b3n;
const mask = 0xffffffffffffffffn;
function fnv1a64(text: string, seed: bigint): string {
	let hash = seed;
	for (const byte of new TextEncoder().encode(text)) {
		hash ^= BigInt(byte);
		hash = (hash * fnvPrime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}

/** Identity of an attempt's conditions (U5). Not a security hash. */
export function fingerprint(
	tool: ToolDescriptor,
	input: JsonObject,
	stateDigest: string | null,
): string {
	const fields = tool.fingerprintFields;
	const conditions = fields
		? Object.fromEntries(
				fields.filter((key) => key in input).map((key) => [key, input[key]!]),
			)
		: input;
	const text = canonicalJson({
		tool: tool.name,
		input: normalize(conditions),
		state:
			tool.sideEffect === "workspace" || tool.readsWorkspace
				? stateDigest
				: null,
	});
	return `${fnv1a64(text, 0xcbf29ce484222325n)}${fnv1a64(text, 0x84222325cbf29ce4n)}`;
}

/** Digest of an operation's input, for replay detection. */
export function digestJson(value: JsonValue): string {
	const text = canonicalJson(value);
	return `${fnv1a64(text, 0xcbf29ce484222325n)}${fnv1a64(text, 0x84222325cbf29ce4n)}`;
}
