import type { Conditions, VersionRef } from "../src/contracts/index.ts";
import { pursuitGuardsV1 } from "../src/index.ts";

/** E1R is eval-only: E3 without the judge (rules + separate-context review), for runs without LARM. */
export type ConditionName = "E0" | "E1" | "E1R" | "E2" | "E3" | "E4";

const questionSet: VersionRef = {
	id: pursuitGuardsV1.id,
	version: pursuitGuardsV1.version,
};

/** Plan §13: each condition adds one layer to the previous. */
export function conditionsFor(
	name: ConditionName,
	options: {
		adapter: VersionRef | null;
		language: "ja" | "en";
		findings: Conditions["findings"];
		strategyChange: Conditions["strategyChange"];
		selfCheck: Conditions["selfCheck"];
		verifyOn: Conditions["verifyOn"];
		prediction: Conditions["prediction"];
		completionCheck: Conditions["completionCheck"];
	},
): Conditions {
	const base = {
		questionSet,
		adapter: null,
		language: options.language,
		findings: options.findings,
		strategyChange: options.strategyChange,
		selfCheck: options.selfCheck,
		verifyOn: options.verifyOn,
		prediction: options.prediction,
		completionCheck: options.completionCheck,
	} as const;
	switch (name) {
		case "E0":
			return { ...base, rules: false, judge: false, review: false };
		case "E1":
			return { ...base, rules: true, judge: false, review: false };
		case "E1R":
			return { ...base, rules: true, judge: false, review: true };
		case "E2":
			return { ...base, rules: true, judge: true, review: false };
		case "E3":
			return { ...base, rules: true, judge: true, review: true };
		case "E4":
			if (!options.adapter) throw new Error("E4_requires_adapter");
			return {
				...base,
				adapter: options.adapter,
				rules: true,
				judge: true,
				review: true,
			};
	}
}
