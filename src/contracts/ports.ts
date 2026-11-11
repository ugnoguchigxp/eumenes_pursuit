import type { z } from "zod";
import type { JsonObject, JsonValue } from "./json.ts";
import type { LedgerDb } from "./db.ts";

/** What a tool may change. Read-only tools never need a checkpoint. */
export type ToolSideEffect = "none" | "workspace";

export interface ToolDescriptor {
	/** ASCII identifier. */
	readonly name: string;
	readonly description: string;
	/** JSON Schema of the input object. */
	readonly inputSchema: JsonObject;
	readonly sideEffect: ToolSideEffect;
	/** Result depends on the workspace contents (tests, file reads); the state joins the fingerprint. */
	readonly readsWorkspace?: boolean;
	/** Returns the current deliverable itself, so calling it is a re-read (spec/completion-design.md). */
	readonly readsBack?: boolean;
	/** A successful result adds evidence for acceptance even when the tool reads the workspace. */
	readonly acceptanceEvidence?: true;
	/**
	 * Opt-in for declarative deliverable writes. A successful write can be reused during partial
	 * finalization if it was read back and the workspace is unchanged. List only input keys whose
	 * values affect neither deliverable content, acceptance, nor side effects. [] compares all keys.
	 */
	readonly reuseWriteIgnoring?: readonly string[];
	/**
	 * How to read a clipped result of this tool again, when calling it again is not the way (e.g. a
	 * budgeted probe whose results the host also keeps in a file). Shown in the clip notice
	 * (spec/fixes-2026-10-22-e.md §8).
	 */
	readonly reread?: string;
	/** Grant key the pursuit must hold to call this tool. */
	readonly permission: string;
	/** Input keys that define the attempt's conditions; absent = the whole input. */
	readonly fingerprintFields?: readonly string[];
	/** Host attests these fingerprint fields/state rules match its v1 descriptor. Absent = legacy history cannot be compared safely. */
	readonly legacyFingerprintCompatible?: boolean;
	/**
	 * Input field that may be supplied as raw text (proofs, code) instead of inside
	 * the JSON input, so the model does not have to escape it twice.
	 */
	readonly textField?: string;
}

export interface ArtifactRef {
	readonly kind: "artifact" | "source";
	readonly uri: string;
	readonly note?: string;
}

/** Something a tool or a check established, kept apart from the hypothesis (spec/findings-design.md). */
export interface FindingInput {
	readonly kind: "lemma" | "counterexample" | "observation";
	readonly statement: string;
	readonly assurance: Assurance;
}

/** Coordinates of output.text in a saved source, in UTF-16 code units. */
export interface SourceExcerpt {
	readonly id: string;
	readonly version: string;
	/** Null when a search returned no excerpt. */
	readonly start: number | null;
	readonly storedLength: number;
	readonly sourceTruncated: boolean;
	/** Present for search results; null means the requested string was not found. */
	readonly matchIndex?: number | null;
}

export interface ToolOutcome {
	readonly status: "ok" | "error";
	/** Bounded, already summarized by the host. */
	readonly output: JsonValue;
	readonly sourceExcerpt?: SourceExcerpt;
	readonly errorCode?: string;
	/**
	 * Full text of streams the host clipped in `output`. refutedIf is judged on it as well, so a
	 * needle cut out of the display still counts; it is stored but never shown.
	 */
	readonly unclipped?: readonly string[];
	readonly refs: readonly ArtifactRef[];
	readonly findings?: readonly FindingInput[];
}

/** Eumenes replaces this with its toolchain. */
export interface ToolPort {
	list(): readonly ToolDescriptor[];
	/** Reserve external work in the same writer transaction as its started attempt.
	 * Return null for a synchronous tool. Never perform network I/O or retain db here.
	 */
	deferInTransaction?(
		db: LedgerDb,
		call: { readonly tool: string; readonly input: JsonObject },
		context: { readonly pursuitId: string; readonly attemptId: string },
	): { readonly operationId: string } | null;
	invoke(
		call: { readonly tool: string; readonly input: JsonObject },
		signal: AbortSignal,
	): Promise<ToolOutcome>;
}

/** Host-computed change features of the workspace since a checkpoint. */
export interface WorkspaceChanges {
	readonly filesTouched: readonly string[];
	/**
	 * Of filesTouched, the paths that did not exist at the checkpoint (optional; v1.8). The engine
	 * uses it against the pursuit's first checkpoint to tell generated outputs from task files.
	 */
	readonly filesCreated?: readonly string[];
	readonly linesChanged: number;
	/** Existing acceptance checks or tests that were changed or deleted (adding tests is not a touch). */
	readonly protectedTouched: readonly string[];
}

/** Present only when some tool has `sideEffect: "workspace"`. */
export interface WorkspacePort {
	checkpoint(): Promise<string>;
	/**
	 * Return the workspace to the checkpoint. Files with a path segment in `keep.dirs` (scratch
	 * work, v1.8) are left exactly as they are now: neither restored, deleted nor added. A port
	 * that ignores `keep` restores everything, as before v1.8.
	 */
	restore(
		checkpoint: string,
		keep?: { readonly dirs: readonly string[] },
	): Promise<void>;
	/** Digest of the current contents; part of the fingerprint of side-effect attempts. */
	digest(): Promise<string>;
	changesSince(checkpoint: string): Promise<WorkspaceChanges>;
}

export interface CriterionResult {
	readonly id: string;
	readonly passed: boolean;
	/** Short evidence (test summary, compared values). */
	readonly evidence: string;
	/**
	 * How sure the check is: exact (deterministic or exact arithmetic), numeric
	 * (high-precision evaluation within a tolerance), model (an LLM grader).
	 * Absent means exact.
	 */
	readonly assurance?: Assurance;
	/** Parts the check established on their own (e.g. lemmas graded within one proof). */
	readonly findings?: readonly FindingInput[];
	/** Optional provenance and diagnosis. The host's acceptance predicate still uses the verdict. */
	readonly verification?: {
		readonly targetVersion: string | null;
		/** Digest of the input prepared for model-based verification, when available. */
		readonly inputDigest?: string;
		readonly failure?:
			| "nonconforming"
			| "missing_evidence"
			| "verification_failed"
			| "verification_timeout"
			| "unknown";
		readonly usedEvidence: readonly (
			| {
					readonly kind: "source";
					readonly id: string;
					readonly version: string;
					readonly truncated: boolean;
					readonly totalCharacters: number;
					readonly ranges: readonly { start: number; length: number }[];
			  }
			| {
					readonly kind: "artifact" | "review";
					readonly id: string;
					readonly version: string;
					readonly attempt: number;
			  }
		)[];
		/** Source IDs needed to resolve the criterion when failure is missing_evidence. */
		readonly missingEvidenceIds?: readonly string[];
	};
}

export type Assurance = "exact" | "numeric" | "model";

/** Host-held verification, outside the executor's reach. Return every frozen criterion exactly once; no other IDs. */
export interface AcceptancePort {
	verify(signal: AbortSignal): Promise<readonly CriterionResult[]>;
}

export type LlmPurpose =
	| "plan"
	| "hypothesize"
	| "propose"
	| "review"
	/** The direct baseline (eval/direct.ts), outside the pursuit engine. */
	| "direct"
	/** Host-side choice of direct solving or a structured pursuit. */
	| "select"
	/** Rubric grading by the eval grader (spec/fixes-2026-10-22-g.md §2), not a pursuit review. */
	| "grade";

export interface LlmRequest<T> {
	readonly purpose: LlmPurpose;
	readonly system: string;
	readonly prompt: string;
	readonly schema: z.ZodType<T>;
	readonly maxOutputTokens: number;
}

export interface LlmResult<T> {
	readonly value: T;
	readonly model: string;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cacheReadTokens: number | null;
	readonly latencyMs: number;
}

/** One stateless structured call. Each call is a fresh context. */
export interface LlmPort {
	complete<T>(
		request: LlmRequest<T>,
		signal: AbortSignal,
	): Promise<LlmResult<T>>;
}

export interface Clock {
	now(): number;
}

export interface IdSource {
	next(prefix: string): string;
}
