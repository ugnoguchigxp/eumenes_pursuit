import { z } from "zod";

const count = z.int().min(1);
const ratio = z.number().min(0).max(1);

/** Budgets and thresholds. Values live in the host's settings (config/policy.*.json), never in code. */
export const policySchema = z.strictObject({
	version: z.int().min(1),
	budget: z.strictObject({
		attempts: count,
		wallMs: count,
		attemptsPerHypothesis: count,
		hypothesesPerStrategy: count,
		strategies: count,
		stepBacks: count,
		/** Rejected proposals in a row before the hypothesis is abandoned. */
		rejectionsInRow: count,
		/** Ledger revisions (every step bumps one); caps loops that execute nothing. */
		transitions: count,
	}),
	signals: z.strictObject({
		consecutiveFailures: count,
		mismatchNotShrinking: count,
		scopeGrowth: count,
		revisits: count,
		protectedTouches: count,
		goalDrift: count,
	}),
	retry: z.strictObject({
		/** Retries of a failed fingerprint allowed when a reason is given. */
		sameFingerprintWithReason: z.int().min(0),
	}),
	judge: z.strictObject({
		confidence: ratio,
		/** P(yes) at or above which a guard question fires. */
		guardYes: ratio,
		/** D3 level (0-based fraction of the scale) below which an attempt counts as mismatch. */
		mismatchBelow: ratio,
		/** Consecutive post-attempt trajectory alarms in one hypothesis before acting on them. */
		trajectoryPersist: count,
	}),
	/** Limits of the text placed in the judge state. */
	judgeState: z.strictObject({
		maxChars: count,
		textChars: count,
	}),
});

export type Policy = z.infer<typeof policySchema>;
