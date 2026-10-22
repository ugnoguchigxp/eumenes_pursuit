/**
 * The claim oracle of an evaluation (spec/fixes-2026-10-22-b.md §6), applied identically to the
 * pursuit (E*) and the direct baseline (D0): how much a completion claim's verify tells the
 * generator, and how many failed claims a task allows.
 *
 * - evidence "full" (default, as before): each criterion's evidence as the task wrote it (for
 *   hz11 env tasks 「隠された検査 k/n 通過」).
 * - evidence "binary": each criterion's evidence is only 合格 / 不合格. Hidden-check counts no
 *   longer leak through claims, so claims cannot be used to hill-climb on k/n. Metrics keep
 *   the real counts (RunRecord.hiddenPassed comes from the task's outcomeFacts, not from here).
 * - limit N (default none): after N failed claims the task ends (forced stop), so a claim is a
 *   commitment, not a probe. The rule is stated in the goal both conditions receive.
 */
import type { AcceptancePort } from "../src/contracts/index.ts";
import type { PursuitView } from "../src/domains/ledger/types.ts";

export type ClaimEvidence = "full" | "binary";
export interface ClaimOracle {
	readonly evidence: ClaimEvidence;
	readonly limit: number | null;
}

export const claimLimitReason = "完了の申告の上限に達しました";

export function parseClaimOracle(values: {
	"claim-evidence"?: string;
	"claim-limit"?: string;
}): ClaimOracle {
	const evidence = (values["claim-evidence"] ?? "full") as ClaimEvidence;
	if (!["full", "binary"].includes(evidence))
		throw new Error("--claim-evidence must be full or binary");
	const raw = values["claim-limit"] ?? "";
	const limit = raw === "" ? null : Number(raw);
	if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100))
		throw new Error("--claim-limit must be an integer from 1 to 100");
	return { evidence, limit };
}

export const isDefaultOracle = (o: ClaimOracle) =>
	o.evidence === "full" && o.limit === null;

/** Variant tag, the same for D0 and the pursuit; "" for the defaults (old variants unchanged). */
export const oracleTag = (o: ClaimOracle) =>
	`${o.limit === null ? "" : `/CL-${o.limit}`}${o.evidence === "full" ? "" : `/CE-${o.evidence}`}`;

/** Acceptance whose evidence says only 合格/不合格 (evidence "binary"); `passed` is unchanged. */
export function oracleAcceptance(
	port: AcceptancePort,
	o: ClaimOracle,
): AcceptancePort {
	if (o.evidence === "full") return port;
	return {
		verify: async (signal) =>
			(await port.verify(signal)).map((r) => ({
				...r,
				evidence: r.passed ? "合格" : "不合格",
			})),
	};
}

/** The hz11 env tasks' goal sentence on what a claim returns (eval/tasks/e/env.ts). */
export const countSentence = "返るのは通過した検査の数だけ。";
export const binarySentence = "返るのは受入条件ごとの合格・不合格だけ。";

/**
 * The goal both conditions receive: the task's goal plus the claim rules when not default. With
 * binary evidence, the task's own sentence on what a claim returns follows the setting
 * (spec/fixes-2026-10-22-c.md §1).
 */
export function oracleGoal(goal: string, o: ClaimOracle): string {
	if (isDefaultOracle(o)) return goal;
	if (o.evidence === "binary")
		goal = goal.replaceAll(countSentence, binarySentence);
	const rules = [
		o.limit === null
			? ""
			: `完了の申告は ${o.limit} 回までです。${o.limit} 回目の申告も不合格なら、この課題はそこで終わります（未達として扱います）。申告は、受入条件を満たしたと確かめてから行ってください。`,
		o.evidence === "binary"
			? "申告の照合結果は、受入条件ごとの合格・不合格だけが示されます（隠された検査の通過数は示されません）。"
			: "",
	].filter(Boolean);
	return `${goal}\n\n【完了の申告の決まり】${rules.join("")}`;
}

/** Failed claims after which the task ends, or false. */
export const claimLimitReached = (failedClaims: number, o: ClaimOracle) =>
	o.limit !== null && failedClaims >= o.limit;

/** Failed completion claims of a pursuit (E*: the harness checks the limit after every step). */
export const failedClaims = (view: Pick<PursuitView, "verifications">) =>
	view.verifications.filter((v) => v.trigger === "claim" && !v.passed).length;
