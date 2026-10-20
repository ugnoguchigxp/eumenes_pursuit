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
