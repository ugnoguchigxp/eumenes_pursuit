import type {
	JsonObject,
	JsonValue,
	ToolDescriptor,
} from "../../contracts/index.ts";

/** Key-sorted JSON, so equal values always serialize identically. Undefined keys drop out, as in JSON. */
export function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.filter((key) => value[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
		.join(",")}}`;
}

/** Frozen v1 normalization, used only when comparing attested legacy history. */
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
export function legacyFingerprint(
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

function conditions(tool: ToolDescriptor, input: JsonObject): JsonObject {
	const fields = tool.fingerprintFields;
	return fields
		? Object.fromEntries(
				fields.filter((k) => k in input).map((k) => [k, input[k]!]),
			)
		: input;
}
function contract(tool: ToolDescriptor): string {
	return digestJson({
		name: tool.name,
		fields: tool.fingerprintFields ? [...tool.fingerprintFields].sort() : null,
		workspace: tool.sideEffect === "workspace" || tool.readsWorkspace === true,
	});
}
/** v2 preserves string contents; only object key order is irrelevant. */
export function fingerprint(
	tool: ToolDescriptor,
	input: JsonObject,
	stateDigest: string | null,
): string {
	return `v2:${contract(tool)}:${digestJson({ input: conditions(tool, input), state: tool.sideEffect === "workspace" || tool.readsWorkspace ? stateDigest : null })}`;
}
/** Null means historical contract unknown: request review rather than reset history. */
export function sameConditions(
	previous: { tool: string; input: JsonObject; fingerprint: string },
	tool: ToolDescriptor,
	input: JsonObject,
	stateDigest: string | null,
): boolean | null {
	if (previous.tool !== tool.name) return false;
	if (previous.fingerprint.startsWith("v2:")) {
		if (!previous.fingerprint.startsWith(`v2:${contract(tool)}:`)) return null;
		return previous.fingerprint === fingerprint(tool, input, stateDigest);
	}
	if (!tool.legacyFingerprintCompatible) return null;
	return (
		previous.fingerprint === legacyFingerprint(tool, input, stateDigest) &&
		canonicalJson(conditions(tool, previous.input)) ===
			canonicalJson(conditions(tool, input))
	);
}

/** Digest of an operation's input, for replay detection. */
export function digestJson(value: JsonValue): string {
	const text = canonicalJson(value);
	return `${fnv1a64(text, 0xcbf29ce484222325n)}${fnv1a64(text, 0x84222325cbf29ce4n)}`;
}
