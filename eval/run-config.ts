import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/domains/rules/fingerprint.ts";
import type { JsonValue } from "../src/index.ts";

/** Constructed from a whitelist of effective settings, never process.env or credentials. */
export interface EffectiveRunConfig {
	readonly format: 1;
	readonly roles: JsonValue;
	readonly judge: JsonValue;
	readonly policy: JsonValue;
	readonly execution: JsonValue;
	readonly experience: readonly string[];
	readonly sourceId: string;
	readonly privateDataVersion: string | null;
}

export function configIdentity(config: EffectiveRunConfig): string {
	return new Bun.CryptoHasher("sha256")
		.update(canonicalJson(config as unknown as JsonValue))
		.digest("hex");
}
export function jobKey(
	task: string,
	condition: string,
	configId: string,
	repeat: number,
): string {
	return JSON.stringify([task, condition, configId, repeat]);
}
export function recordKey(r: {
	task: string;
	condition: string;
	configId?: string;
	generator: string;
	repeat: number;
}): string {
	return r.configId
		? jobKey(r.task, r.condition, r.configId, r.repeat)
		: JSON.stringify(["legacy", r.task, r.condition, r.generator, r.repeat]);
}
export function recordVariant(r: {
	configId?: string;
	generator: string;
}): string {
	return `${r.generator}@${r.configId ?? "legacy"}`;
}

/** Runtime source and fixtures, including dirty contents. Outputs and test code are excluded. */
export function sourceIdentity(root: string): string {
	const files: string[] = ["package.json", "bun.lock"];
	function walk(rel: string) {
		for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
			if (
				["results", "node_modules", "test", "__pycache__", ".git"].includes(
					e.name,
				)
			)
				continue;
			const path = `${rel}/${e.name}`;
			if (e.isDirectory()) walk(path);
			else if (e.isFile() && !e.name.endsWith(".test.ts")) files.push(path);
		}
	}
	for (const rel of ["src", "standalone", "eval", "config"]) walk(rel);
	const hash = new Bun.CryptoHasher("sha256");
	for (const path of files.sort())
		hash.update(
			JSON.stringify([
				path,
				new Bun.CryptoHasher("sha256")
					.update(readFileSync(join(root, path)))
					.digest("hex"),
			]),
		);
	return hash.digest("hex");
}
