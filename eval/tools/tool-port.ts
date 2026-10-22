import type {
	ArtifactRef,
	JsonObject,
	JsonValue,
	ToolDescriptor,
	ToolOutcome,
	ToolPort,
	ToolSideEffect,
} from "../../src/contracts/index.ts";

export interface ToolDef {
	readonly descriptor: ToolDescriptor;
	/** Agent mistakes return `fail(...)`; only harness bugs may throw. */
	run(input: JsonObject, signal: AbortSignal): Promise<ToolOutcome>;
}

export function ok(
	output: JsonValue,
	refs: readonly ArtifactRef[] = [],
): ToolOutcome {
	return { status: "ok", output, refs };
}

export function fail(
	errorCode: string,
	message: string,
	refs: readonly ArtifactRef[] = [],
): ToolOutcome {
	return { status: "error", errorCode, output: { message }, refs };
}

export function prop(
	type: "string" | "integer" | "number" | "boolean",
	description: string,
	extra: JsonObject = {},
): JsonObject {
	return { type, description, ...extra };
}

export interface ToolSpec {
	readonly name: string;
	readonly description: string;
	readonly permission: string;
	readonly properties?: Record<string, JsonObject>;
	readonly required?: readonly string[];
	readonly sideEffect?: ToolSideEffect;
	readonly fingerprintFields?: readonly string[];
	readonly readsWorkspace?: boolean;
	readonly readsBack?: boolean;
	readonly textField?: string;
	/** How to re-read a clipped result (ToolDescriptor.reread, fixes-2026-10-22-e §8). */
	readonly reread?: string;
}

export function defineTool(spec: ToolSpec, run: ToolDef["run"]): ToolDef {
	const inputSchema: JsonObject = {
		type: "object",
		properties: spec.properties ?? {},
		required: [...(spec.required ?? [])],
		additionalProperties: false,
	};
	const base = {
		name: spec.name,
		// These evaluation descriptors retain the v1 fingerprint fields and state rules.
		legacyFingerprintCompatible: true,
		description: spec.description,
		inputSchema,
		sideEffect: spec.sideEffect ?? "none",
		permission: spec.permission,
		...(spec.readsWorkspace ? { readsWorkspace: true } : {}),
		...(spec.readsBack ? { readsBack: true } : {}),
		...(spec.textField ? { textField: spec.textField } : {}),
		...(spec.reread ? { reread: spec.reread } : {}),
	} as const;
	const descriptor: ToolDescriptor =
		spec.fingerprintFields === undefined
			? base
			: { ...base, fingerprintFields: spec.fingerprintFields };
	return { descriptor, run };
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Minimal JSON Schema check (the subset the eval tools declare). */
export function validateInput(
	schema: JsonObject,
	value: JsonValue | undefined,
	at = "input",
): string | null {
	const choices = schema.enum;
	if (Array.isArray(choices) && !choices.some((choice) => choice === value)) {
		return `${at} must be one of ${JSON.stringify(choices)}`;
	}
	switch (schema.type) {
		case "string": {
			if (typeof value !== "string") return `${at} must be a string`;
			const { minLength, maxLength } = schema;
			if (typeof minLength === "number" && value.length < minLength) {
				return `${at} is too short (min ${minLength})`;
			}
			if (typeof maxLength === "number" && value.length > maxLength) {
				return `${at} is too long (max ${maxLength})`;
			}
			return null;
		}
		case "integer":
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return `${at} must be a number`;
			}
			if (schema.type === "integer" && !Number.isInteger(value)) {
				return `${at} must be an integer`;
			}
			const { minimum, maximum } = schema;
			if (typeof minimum === "number" && value < minimum) {
				return `${at} must be >= ${minimum}`;
			}
			if (typeof maximum === "number" && value > maximum) {
				return `${at} must be <= ${maximum}`;
			}
			return null;
		}
		case "boolean":
			return typeof value === "boolean" ? null : `${at} must be a boolean`;
		case "array": {
			if (!Array.isArray(value)) return `${at} must be an array`;
			const { maxItems, items } = schema;
			if (typeof maxItems === "number" && value.length > maxItems) {
				return `${at} has too many items (max ${maxItems})`;
			}
			if (isObject(items)) {
				for (const [index, item] of value.entries()) {
					const error = validateInput(items, item, `${at}[${index}]`);
					if (error !== null) return error;
				}
			}
			return null;
		}
		case "object": {
			if (!isObject(value)) return `${at} must be an object`;
			const properties = isObject(schema.properties) ? schema.properties : {};
			const required = Array.isArray(schema.required) ? schema.required : [];
			for (const key of required) {
				if (typeof key === "string" && !(key in value)) {
					return `${at}.${key} is required`;
				}
			}
			for (const [key, child] of Object.entries(value)) {
				const childSchema = properties[key];
				if (!isObject(childSchema)) {
					if (schema.additionalProperties === false) {
						return `${at}.${key} is not an accepted property`;
					}
					continue;
				}
				const error = validateInput(childSchema, child, `${at}.${key}`);
				if (error !== null) return error;
			}
			return null;
		}
		default:
			return null;
	}
}

export function createToolPort(defs: readonly ToolDef[]): ToolPort {
	const byName = new Map(defs.map((def) => [def.descriptor.name, def]));
	return {
		list: () => defs.map((def) => def.descriptor),
		async invoke(call, signal) {
			const def = byName.get(call.tool);
			if (def === undefined) {
				return fail("unknown_tool", `no such tool: ${call.tool}`);
			}
			const error = validateInput(def.descriptor.inputSchema, call.input);
			if (error !== null) return fail("invalid_input", error);
			if (signal.aborted) return fail("aborted", "the call was aborted");
			return def.run(call.input, signal);
		},
	};
}
