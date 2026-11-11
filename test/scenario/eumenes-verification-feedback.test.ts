import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIConnectionTimeoutError } from "openai";
import { fixture, scripted } from "../../examples/eumenes/fixtures.ts";
import { hash } from "../../examples/eumenes/hash.ts";
import { openExample } from "../../examples/eumenes/host.ts";
import type { CriterionResult } from "../../src/index.ts";

test.each([
	"nonconforming",
	"missing_evidence",
	"verification_timeout",
] as const)(
	"verification records the target, reason and evidence for %s",
	async (failure) => {
		const directory = await mkdtemp(join(tmpdir(), "pursuit-verification-"));
		const research = fixture("museum", { lookup: 1, read: 1, stagger: 1 });
		const base = scripted("museum");
		const decisions: CriterionResult[][] = [];
		const inputs: string[] = [];
		const omitted = "採点用の先頭抜粋に入らない観測";
		const open = () =>
			openExample({
				directory,
				execution: "productive",
				request: research.request,
				limits: research.limits,
				async web(request, signal) {
					const response = await research.web(request, signal);
					if (failure !== "missing_evidence") return response;
					return {
						...response,
						documents: response.documents.map((doc) =>
							doc.url === research.sources[0]!.url
								? { ...doc, text: doc.text + " ".repeat(61000) + omitted }
								: doc,
						),
					};
				},
				generator: {
					async complete(request, signal) {
						if (request.purpose === "propose") {
							const { state } = JSON.parse(request.prompt);
							const { verifications } = JSON.parse(state.split("\n\n").at(-1));
							decisions.push(
								...verifications.map(
									(v: { criteria: CriterionResult[] }) => v.criteria,
								),
							);
						}
						const response = await base.complete(request, signal);
						if (request.purpose !== "grade") return response;
						const { state } = JSON.parse(request.prompt);
						inputs.push(state);
						if (failure === "verification_timeout" && inputs.length === 1)
							throw new APIConnectionTimeoutError();
						if (failure === "verification_timeout") return response;
						const packet = JSON.parse(state);
						const missing = packet.evidence.find(
							(source: { url: string }) =>
								source.url === research.sources[0]!.url,
						);
						if (failure === "missing_evidence") {
							expect(state).not.toContain(omitted);
							expect(missing.totalCharacters).toBeGreaterThan(61000);
						}
						return {
							...response,
							value: request.schema.parse({
								passed: false,
								evidence: "固定応答の判定理由",
								failure,
								missingEvidence:
									failure === "missing_evidence" ? [missing.evidence] : [],
							}),
						};
					},
				},
			});
		let host = await open();
		try {
			if (failure !== "verification_timeout") {
				const paused = await host.drive(
					undefined,
					(step) => step.event === "rejected",
				);
				expect(paused.paused).toBe(true);
				expect(paused.view.verifications).toHaveLength(1);
				await host.close();
				host = await open();
			}
			const { view } = await host.drive();
			expect(view.status).toBe("incomplete");
			expect(
				view.attempts.filter((a) => a.tool === "report_draft"),
			).toHaveLength(1);
			const answer = view.verifications[0]?.criteria.find(
				(c) => c.id === "answer",
			);
			const packet = JSON.parse(inputs[0]!);
			expect(answer?.passed).toBe(false);
			expect(answer?.verification).toMatchObject({
				targetVersion: hash(packet.report),
				inputDigest: hash(inputs[0]),
				failure,
			});
			if (failure === "verification_timeout") {
				expect(answer?.verification?.usedEvidence).toEqual([]);
				expect(inputs).toHaveLength(2);
				expect(view.report?.verified).toBe(true);
				expect(view.report?.verificationIssue).toBeUndefined();
				return;
			}
			expect(decisions.flat()).toContainEqual(answer!);
			expect(inputs).toHaveLength(1);
			expect(view.report?.verified).toBe(false);
			const expectedSources = packet.evidence.map(
				(source: {
					evidence: string;
					excerpts: { start: number; text: string }[];
				}) => ({
					kind: "source",
					id: source.evidence,
					ranges: source.excerpts.map((excerpt) => ({
						start: excerpt.start,
						length: excerpt.text.length,
					})),
				}),
			);
			expect(answer?.verification?.usedEvidence).toMatchObject([
				...expectedSources,
				{ kind: "artifact", version: packet.markdownSave.sha256 },
			]);
			if (failure === "missing_evidence")
				expect(answer?.verification?.missingEvidenceIds).toHaveLength(1);
		} finally {
			await host.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
