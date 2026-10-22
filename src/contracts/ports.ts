import type { z } from "zod";
import type { JsonObject, JsonValue } from "./json.ts";

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

export interface ToolOutcome {
	readonly status: "ok" | "error";
	/** Bounded, already summarized by the host. */
	readonly output: JsonValue;
	readonly errorCode?: string;
	readonly refs: readonly ArtifactRef[];
	readonly findings?: readonly FindingInput[];
}

/** Eumenes replaces this with its toolchain. */
export interface ToolPort {
	list(): readonly ToolDescriptor[];
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
}

export type Assurance = "exact" | "numeric" | "model";

/** Host-held verification, outside the executor's reach. Return every frozen criterion exactly once; no other IDs. */
export interface AcceptancePort {
	verify(signal: AbortSignal): Promise<readonly CriterionResult[]>;
}

export type LlmPurpose = "plan" | "hypothesize" | "propose" | "review";

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
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
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
