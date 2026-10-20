import type {
	Answer,
	ArtifactRef,
	CriterionResult,
	DecidedBy,
	DecisionKind,
	JsonObject,
	JsonValue,
	PursuitStatus,
	Report,
	StartInput,
	VersionRef,
} from "../../contracts/index.ts";

export interface Prediction {
	readonly expectedStatus: "ok" | "error";
	readonly expectedObservation: string;
	/** What observation would show the hypothesis wrong; with prediction "falsifiable". */
	readonly refutedIf?: string;
}

export interface AcceptanceRow {
	readonly id: string;
	readonly text: string;
	readonly method: "machine" | "human";
}

export interface PartAssessment {
	/** 1-based index into the strategy's parts. */
	readonly part: number;
	readonly status: "done" | "blocked" | "untried";
	readonly evidence: string;
	/** For blocked parts: the next move still worth trying; empty when none. */
	readonly next: string;
}

export interface StrategyRow {
	readonly id: string;
	readonly seq: number;
	readonly body: string;
	readonly rationale: string;
	readonly alternatives: readonly string[];
	/** Parts the strategy needs (selfCheck "parts"); empty otherwise. */
	readonly parts: readonly string[];
	/** The generator's latest self-assessment of the parts; null before the first. */
	readonly assessment: readonly PartAssessment[] | null;
	readonly status: "active" | "closed";
	readonly closeReason: string | null;
	readonly previousId: string | null;
}

export interface HypothesisRow {
	readonly id: string;
	readonly strategyId: string;
	readonly seq: number;
	readonly body: string;
	readonly rationale: string;
	readonly tools: readonly string[];
	readonly expected: string;
	readonly budget: number;
	readonly checkpoint: string | null;
	readonly status: "active" | "closed";
	readonly result: string | null;
}

/** Rule codes are stable identifiers; detail is for the generator and the report. */
export interface Rejection {
	readonly rule: string;
	readonly detail: string;
}

export interface Observation {
	readonly status: "ok" | "error";
	readonly output: JsonValue;
	readonly errorCode: string | null;
}

/** Host-computed facts about one attempt (plan §8.3). */
export interface AttemptFeatures {
	readonly filesTouched: readonly string[];
	readonly linesChanged: number;
	readonly protectedTouched: readonly string[];
	/** D3 normalized to 0..1, null without a usable judgement. */
	readonly match: number | null;
	/** D5 normalized to 0..1, null without a usable judgement. */
	readonly progress: number | null;
}

export interface AttemptRow {
	readonly id: string;
	readonly hypothesisId: string;
	readonly seq: number;
	readonly state: "rejected" | "started" | "settled" | "interrupted";
	readonly tool: string;
	readonly input: JsonObject;
	readonly prediction: Prediction;
	readonly whatChanged: string;
	readonly fingerprint: string;
	readonly rejection: readonly Rejection[] | null;
	readonly observation: Observation | null;
	readonly outcome: "success" | "failure" | null;
	readonly refs: readonly ArtifactRef[];
	readonly features: AttemptFeatures | null;
	readonly startedAt: number;
}

export interface JudgementRow {
	readonly attemptId: string | null;
	readonly stage: "pre" | "post" | "review";
	readonly questionSet: VersionRef;
	readonly questionId: string;
	readonly answer: Answer;
	readonly threshold: number;
	readonly fired: boolean;
	readonly usable: boolean;
	readonly model: string;
	readonly adapter: VersionRef | null;
}

export interface DecisionRow {
	readonly seq: number;
	readonly kind: DecisionKind;
	readonly reason: string;
	readonly basis: JsonObject;
	readonly decidedBy: DecidedBy;
}

export interface ConsultationRow {
	readonly id: string;
	readonly question: string;
	readonly missing: string;
	readonly options: readonly string[];
	readonly answer: string | null;
	readonly askedAt: number;
	readonly answeredAt: number | null;
}

export interface VerificationRow {
	readonly attemptId: string | null;
	readonly trigger: "attempt" | "claim" | "final";
	readonly passed: boolean;
	readonly criteria: readonly CriterionResult[];
}

export interface InferenceRow {
	readonly purpose: string;
	readonly model: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly latencyMs: number;
}

/** Everything the loop needs, rebuilt from the ledger on every step. */
export interface PursuitView {
	readonly id: string;
	readonly goal: string;
	readonly status: PursuitStatus;
	readonly revision: number;
	readonly input: StartInput;
	readonly currentStrategyId: string | null;
	readonly currentHypothesisId: string | null;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly acceptance: readonly AcceptanceRow[];
	readonly strategies: readonly StrategyRow[];
	readonly hypotheses: readonly HypothesisRow[];
	readonly attempts: readonly AttemptRow[];
	readonly judgements: readonly JudgementRow[];
	readonly decisions: readonly DecisionRow[];
	readonly consultations: readonly ConsultationRow[];
	readonly verifications: readonly VerificationRow[];
	readonly inference: readonly InferenceRow[];
	readonly report: Report | null;
	readonly findings: readonly FindingRow[];
}

/** Something worth keeping apart from the hypothesis that produced it (spec/findings-design.md). */
export interface FindingRow {
	readonly id: string;
	readonly seq: number;
	readonly kind: "lemma" | "counterexample" | "observation" | "dead_end";
	readonly statement: string;
	readonly assurance: "exact" | "numeric" | "model" | "unverified";
	readonly sourceAttemptId: string | null;
	readonly scope: "pursuit" | "strategy" | "hypothesis";
	readonly strategyId: string | null;
	readonly hypothesisId: string | null;
	readonly status: "active" | "superseded" | "refuted";
	readonly reason: string | null;
}
