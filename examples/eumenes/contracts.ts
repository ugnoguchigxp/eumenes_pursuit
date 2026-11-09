// Copied Eumenes research schemas without modification.
import { z } from "zod";
export const researchDraft = z.strictObject({
	completion: z.enum(["complete", "incomplete"]),
	answer: z.string().min(1).max(16000),
	summary: z.string().min(1).max(2000),
	claims: z
		.array(
			z.strictObject({
				text: z.string().min(1).max(1200),
				status: z.enum(["verified", "unknown", "conflicting"]),
				evidence: z.array(z.string().regex(/^e[1-9][0-9]*$/)).max(6),
			}),
		)
		.max(24),
	limitations: z.array(z.string().min(1).max(600)).max(16),
	stopReason: z.string().min(1).max(1000),
});
export const researchDocumentDraft = researchDraft.extend({
	title: z.string().trim().min(1).max(200),
});
export type ResearchDraft = z.infer<typeof researchDraft> & { title?: string };
