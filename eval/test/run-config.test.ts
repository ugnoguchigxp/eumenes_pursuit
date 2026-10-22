import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	configIdentity,
	sourceIdentity,
	jobKey,
	recordKey,
	type EffectiveRunConfig,
} from "../run-config.ts";
const config: EffectiveRunConfig = {
	format: 1,
	roles: { generator: { provider: "claude", model: "m", effort: "high" } },
	judge: { language: "ja", adapter: null },
	policy: { version: 1, wallMs: 10 },
	execution: { tools: 0 },
	experience: [],
	sourceId: "source",
	privateDataVersion: null,
};
test("effective settings content defines identity, independent of object key order", () => {
	const id = configIdentity(config);
	expect(
		configIdentity({ ...config, policy: { wallMs: 10, version: 1 } }),
	).toBe(id);
	for (const changed of [
		{ ...config, judge: { language: "en", adapter: null } },
		{ ...config, judge: { language: "ja", adapter: "new" } },
		{ ...config, policy: { version: 1, wallMs: 11 } },
		{ ...config, roles: { generator: { model: "other" } } },
		{ ...config, sourceId: "new" },
		{ ...config, privateDataVersion: "v2" },
	])
		expect(configIdentity(changed)).not.toBe(id);
});
test("legacy rows never suppress a versioned job; conditions and repeats remain distinct", () => {
	const r = { task: "t", condition: "E0", generator: "generator", repeat: 1 };
	const id = configIdentity(config);
	expect(recordKey(r)).not.toBe(jobKey("t", "E0", id, 1));
	expect(recordKey({ ...r, configId: id })).toBe(jobKey("t", "E0", id, 1));
	expect(jobKey("t", "E0", id, 1)).not.toBe(jobKey("t", "E0", id, 2));
});

test("runtime source content changes identity; output files, credentials and tests do not", () => {
	const root = mkdtempSync(join(tmpdir(), "config-source-"));
	try {
		for (const dir of [
			"src",
			"standalone",
			"eval",
			"config",
			"eval/results",
			"src/test",
		])
			mkdirSync(join(root, dir), { recursive: true });
		for (const file of ["package.json", "bun.lock", "src/a.ts"])
			writeFileSync(join(root, file), "initial");
		const before = sourceIdentity(root);
		writeFileSync(join(root, "eval/results/runs.jsonl"), "new result");
		writeFileSync(join(root, ".env"), "credential-rotated");
		writeFileSync(join(root, "src/test/a.test.ts"), "new test");
		expect(sourceIdentity(root)).toBe(before);
		writeFileSync(join(root, "src/a.ts"), "dirty source change");
		expect(sourceIdentity(root)).not.toBe(before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
