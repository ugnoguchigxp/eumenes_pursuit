import { expect, test } from "bun:test";
import { assertComparable } from "../experiment.ts";
import type { EffectiveRunConfig } from "../run-config.ts";
const a: EffectiveRunConfig = {
	format: 1,
	roles: { generator: { model: "m" }, reviewer: { model: "m" } },
	judge: null,
	policy: { wall: 1 },
	execution: { conditions: { rules: true }, concurrency: 1 },
	experience: [],
	sourceId: "source",
	privateDataVersion: null,
};
test("comparison permits only predeclared changes and refuses source, model, budget and concurrency drift", () => {
	const b = {
		...a,
		roles: { generator: { model: "m" }, reviewer: null },
		execution: { conditions: { direct: true }, concurrency: 1 },
	};
	expect(() =>
		assertComparable(a, b, ["roles.reviewer", "execution.conditions"]),
	).not.toThrow();
	for (const changed of [
		{ ...b, sourceId: "other" },
		{ ...b, policy: { wall: 2 } },
		{ ...b, roles: { generator: { model: "other" }, reviewer: null } },
		{ ...b, execution: { ...b.execution, concurrency: 2 } },
		{ ...b, privateDataVersion: "different" },
	])
		expect(() =>
			assertComparable(a, changed, ["roles.reviewer", "execution.conditions"]),
		).toThrow("settings_differ");
});
