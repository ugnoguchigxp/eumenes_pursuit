import type {
	AcceptancePort,
	LlmPort,
	ToolPort,
	WorkspacePort,
} from "../src/contracts/index.ts";
import type { z } from "zod";
import type { acceptanceInputSchema } from "../src/contracts/index.ts";

export type TaskGroup = "A" | "B" | "C" | "D" | "E";

/** Exploration aids, added one step at a time to see which one unblocks a failure. */
/** 0 none, 1 + exact calculator, 2 + technique notes, 3 + lemma-level notes. */
export type ToolTier = 0 | 1 | 2 | 3;

export interface TaskContext {
	/** Hidden grader for proofs (a strong model in its own context); null when not needed. */
	readonly grader: LlmPort | null;
	readonly toolTier: ToolTier;
	/** In-loop referee without the rubric (group E `review_draft`); absent = no such tool. */
	readonly critic?: LlmPort | null;
	/**
	 * Grader-only directory of external proof rubrics (`<id>.json`), read by the host when
	 * grading; never reachable from task tools. Absent when no task needs one.
	 */
	readonly rubricDir?: string | null;
	/**
	 * Host-only directory of expected answers for discovery tasks (`<id>.json`); never reachable
	 * from task tools. Absent when no task needs one.
	 */
	readonly secretDir?: string | null;
	/** Local corpus server (horizon-10a): base URL on 127.0.0.1 and its request log (host-only). */
	readonly corpus?: { readonly url: string; readonly log: string } | null;
}

/** Live instance of one task, bound to a throw-away directory. */
export interface TaskInstance {
	readonly tools: ToolPort;
	/** Null when every tool is read-only. */
	readonly workspace: WorkspacePort | null;
	/** Hidden from the executor: reads outputs and runs hidden checks. */
	readonly acceptance: AcceptancePort;
	/**
	 * Host-only facts for the metrics, read after the run (never shown to the executor):
	 * whether the task was solvable as stated and what the executor last submitted.
	 */
	outcomeFacts?(): Promise<OutcomeFacts>;
	/**
	 * Host-only facts from the latest acceptance check, for the metrics (never shown to the
	 * executor): canary hits, the grader's verdict, hidden checks passed.
	 */
	diagnostics?(): TaskDiagnostics;
	dispose(): Promise<void>;
}

export interface TaskDiagnostics {
	/** horizon-10a: canaries obeyed (count and kind only; the canary texts stay host-only). */
	readonly canaryHits?: number;
	readonly canaryKinds?: readonly ("phrase" | "file" | "collect")[];
	/** Exact answer fields right (horizon-10a) or answer right (horizon-10u). */
	readonly answerCorrect?: boolean;
	/** Rubric grader's verdict on the latest check; null when the grader was not asked. */
	readonly graderVerdict?: "pass" | "fail" | null;
	/** horizon-10e: hidden checks passed of total in the latest check. */
	readonly hiddenPassed?: number;
	readonly hiddenTotal?: number;
}

export interface OutcomeFacts {
	readonly solvable: boolean;
	/** answer = a solution, declaration = declare_unsolvable, none = nothing submitted. */
	readonly submitted: "answer" | "declaration" | "none";
}

export interface EvalTask {
	/** Stable id; the unit of train/calibration/eval splits. */
	readonly id: string;
	readonly group: TaskGroup;
	readonly title: string;
	/** Only the goal and conditions; never the method. */
	readonly goal: string;
	readonly acceptance: readonly z.infer<typeof acceptanceInputSchema>[];
	readonly grant: readonly string[];
	/** What the simulated user answers to any consultation. */
	readonly consultAnswer: string;
	/** The correct terminal outcome (group A expects "incomplete"). */
	readonly expected: "completed" | "incomplete";
	/** Deliberate obstacles, for reporting. */
	readonly traps: readonly string[];
	/** Difficulty label for group E (entrance, undergraduate, graduate, research). */
	readonly level?: 1 | 2 | 3 | 4;
	/** Rubric items of a graded proof, for partial credit; absent when not graded by rubric. */
	readonly rubricSize?: number;
	/** Id of an external rubric (TaskContext.rubricDir); the rubric itself is not in the repository. */
	readonly rubricId?: string;
	/** Id of an external expected answer (TaskContext.secretDir); the answer is not in the repository. */
	readonly secretId?: string;
	/** Needs the local corpus server (--corpus-url, --corpus-log). */
	readonly needsCorpus?: boolean;
	/** Goal text for a tool tier, when it differs from `goal` (which is tier 0). */
	goalFor?(tier: ToolTier): string;
	create(directory: string, context: TaskContext): Promise<TaskInstance>;
}
