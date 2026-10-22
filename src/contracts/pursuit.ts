import { z } from "zod";
import { policySchema } from "./policy.ts";
import type { ArtifactRef, CriterionResult } from "./ports.ts";

const ascii = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
export const versionRefSchema = z.strictObject({
	id: ascii,
	version: z.int().min(1),
});

/** Which layers run. E0..E4 of the experiment plan are combinations of these. */
export const conditionsSchema = z.strictObject({
	/** Rule layer: budgets per hypothesis, fingerprints, prediction required, verified completion. */
	rules: z.boolean(),
	judge: z.boolean(),
	review: z.boolean(),
	questionSet: versionRefSchema,
	/** d1 adapter for the question set; null = base model. */
	adapter: versionRefSchema.nullable(),
	/** Criteria text language of the question set. */
	language: z.enum(["ja", "en"]),
	/**
	 * Findings kept apart from hypotheses: off, verified only (checked findings and
	 * dead ends), or all (also the generator's unverified claims, labelled so).
	 */
	findings: z.enum(["off", "verified", "all"]).default("off"),
	/**
	 * How a new strategy relates to earlier ones: free (any other strategy), or
	 * distinct (a different core idea, alternatives listed and offered back).
	 */
	strategyChange: z.enum(["free", "distinct"]).default("free"),
	/**
	 * Self-assessment before leaving a strategy: off, or parts (strategies list
	 * their parts; step back and give up carry a per-part assessment, and the
	 * rules keep a strategy until no part is untried or blocked with a next move).
	 */
	selfCheck: z.enum(["off", "parts"]).default("off"),
	/**
	 * When the host checks acceptance: after every workspace-changing attempt, or
	 * only on a completion claim and at the end (spec/verification-design.md §1).
	 */
	verifyOn: z.enum(["attempt", "claim"]).default("attempt"),
	/**
	 * What a tool proposal predicts: the status and observation, or also what
	 * observation would refute the hypothesis (spec/verification-design.md §3).
	 */
	prediction: z.enum(["status", "falsifiable"]).default("status"),
	/**
	 * Before stepping back or giving up: off, or acceptance (re-read the
	 * deliverable and judge each acceptance criterion; all met means claim).
	 */
	completionCheck: z.enum(["off", "acceptance"]).default("off"),
	/**
	 * When a step back rolls the workspace back to the hypothesis checkpoint (policy.restore
	 * decides when): notify (revert, record the reverted files in the decision basis and name
	 * them in the next generator requests), or keep (never revert). A rollback is never silent.
	 * spec/fixes-2026-10-22.md §a.
	 */
	rollback: z.enum(["notify", "keep"]).default("notify"),
	/**
	 * The verdict label shown for each executed attempt: refutation (judge the stated refutedIf
	 * where it is machine-checkable, otherwise "未判定"; never "予測どおり" from the tool status
	 * alone), or status (v1.6 wording, kept to reproduce earlier runs). The attempt outcome the
	 * rules count is unchanged. spec/fixes-2026-10-22.md §b.
	 */
	verdictLabel: z.enum(["refutation", "status"]).default("refutation"),
	/**
	 * After a completion claim: off (the verdict appears only among the current
	 * hypothesis's attempts and proposal prompt), or verdict (the latest claim's
	 * 合格/不合格 is stated in every later generator and reviewer prompt, and the
	 * next proposal is told explicitly). spec/ablation-design.md.
	 */
	claimFeedback: z.enum(["off", "verdict"]).default("off"),
	/**
	 * What counts toward the per-hypothesis attempt budget: all executed attempts,
	 * or only mutating ones (tools with sideEffect "workspace": writes, runs,
	 * submissions), so reading sources alone cannot exhaust it. The pursuit-wide
	 * attempt budget still counts every attempt.
	 */
	attemptCount: z.enum(["all", "mutating"]).default("all"),
});
export type Conditions = z.infer<typeof conditionsSchema>;

export const acceptanceInputSchema = z.strictObject({
	id: ascii,
	text: z.string().min(1).max(2000),
	method: z.enum(["machine", "human"]),
});

export const startInputSchema = z.strictObject({
	goal: z.string().min(1).max(4000),
	acceptance: z.array(acceptanceInputSchema).min(1).max(20),
	/** Permission keys; a tool whose `permission` is absent here is refused. */
	grant: z.array(z.string().min(1)).max(64),
	policy: policySchema,
	conditions: conditionsSchema,
	/** Opaque reference to the host's goal (Eumenes `goals`), if any. */
	goalRef: z.string().max(200).nullable(),
	/** Opaque grouping key (evaluation task id). Never interpreted. */
	label: z.string().max(200).nullable(),
	/**
	 * Procedural lessons the host chose from earlier pursuits (cue → operation),
	 * shown when planning and forming hypotheses (spec/lessons-design.md).
	 */
	experience: z.array(z.string().min(1).max(300)).max(5).optional(),
});
export type StartInput = z.infer<typeof startInputSchema>;

export type PursuitStatus =
	| "planning"
	| "hypothesizing"
	| "proposing"
	| "reviewing"
	| "awaiting_consultation"
	| "completed"
	| "incomplete"
	| "stopped";

export const terminalStatuses: readonly PursuitStatus[] = [
	"completed",
	"incomplete",
	"stopped",
];

export type DecisionKind =
	| "continue"
	| "change_tool"
	| "change_hypothesis"
	| "revise_strategy"
	| "complete"
	| "consult"
	| "stop"
	| "step_back"
	| "give_up";

export type DecidedBy = "rules" | "judge" | "review" | "human" | "generator";

export type StepEvent =
	| "planned"
	| "hypothesized"
	| "rejected"
	| "executed"
	| "interrupted"
	| "stepped_back"
	| "consult_requested"
	| "consult_answered"
	| "finished";

export interface StepResult {
	readonly pursuitId: string;
	readonly status: PursuitStatus;
	readonly revision: number;
	readonly event: StepEvent;
	readonly done: boolean;
}

export interface Report {
	readonly pursuitId: string;
	readonly outcome: "completed" | "incomplete" | "stopped";
	/** True only when the host's acceptance verification passed. */
	readonly verified: boolean;
	/** Non-completion is durable even while final verification is pending or unavailable. */
	readonly verificationIssue?: "pending" | "aborted" | "failed";
	readonly reason: string;
	readonly criteria: readonly CriterionResult[];
	/** Open questions the user must answer to continue. */
	readonly needs: readonly string[];
	readonly refs: readonly ArtifactRef[];
	readonly stats: {
		readonly attempts: number;
		readonly rejected: number;
		readonly hypotheses: number;
		readonly strategies: number;
		readonly stepBacks: number;
		readonly consultations: number;
	};
	/** Active findings by kind and assurance, plus the checked ones in full. */
	readonly findings: {
		readonly total: number;
		readonly checked: readonly {
			readonly kind: string;
			readonly statement: string;
			readonly assurance: string;
		}[];
	};
}
