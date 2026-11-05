import { canonicalJson } from "../src/domains/rules/fingerprint.ts";
import type { JsonValue } from "../src/index.ts";
import type { EffectiveRunConfig } from "./run-config.ts";

/** Compare declared settings, allowing only the experimental paths chosen before measurement. */
export function assertComparable(
	a: EffectiveRunConfig,
	b: EffectiveRunConfig,
	allowed: readonly string[],
) {
	const different: string[] = [];
	function walk(
		left: JsonValue | undefined,
		right: JsonValue | undefined,
		path: string,
	) {
		if (allowed.some((p) => path === p || path.startsWith(`${p}.`))) return;
		if (left === undefined || right === undefined) {
			if (left !== right) different.push(path);
			return;
		}
		if (canonicalJson(left) === canonicalJson(right)) return;
		if (
			left &&
			right &&
			typeof left === "object" &&
			typeof right === "object" &&
			!Array.isArray(left) &&
			!Array.isArray(right)
		) {
			for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
				walk(left[key], right[key], path ? `${path}.${key}` : key);
		} else different.push(path);
	}
	walk(a as unknown as JsonValue, b as unknown as JsonValue, "");
	if (different.length)
		throw new Error(`comparison_settings_differ:${different.sort().join(",")}`);
}
