import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { policySchema, type StartInput } from "../src/index.ts";

export const policy = policySchema.parse(
	JSON.parse(
		readFileSync(resolve(import.meta.dir, "../config/policy.v1.json"), "utf8"),
	),
);

export function startInput(overrides: Partial<StartInput> = {}): StartInput {
	return {
		goal: "売上表の合計を出す",
		acceptance: [
			{ id: "total", text: "answer.json に合計値がある", method: "machine" },
		],
		grant: ["data.read", "answer.write"],
		policy,
		conditions: {
			rules: true,
			judge: false,
			review: false,
			questionSet: { id: "pursuit-guards", version: 1 },
			adapter: null,
			language: "ja",
			findings: "off",
			strategyChange: "free",
			selfCheck: "off",
			verifyOn: "attempt",
			prediction: "status",
			completionCheck: "off",
			rollback: "notify",
			verdictLabel: "refutation",
			claimFeedback: "off",
			attemptCount: "all",
		},
		goalRef: null,
		label: "unit",
		...overrides,
	};
}
