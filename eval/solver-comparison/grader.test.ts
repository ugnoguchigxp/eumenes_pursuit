import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scripted } from "../../examples/eumenes/fixtures.ts";
import { hash } from "../../examples/eumenes/hash.ts";
import { openExample } from "../../examples/eumenes/host.ts";
import { comparisonCases } from "./fixtures.ts";
import {
	gradeComparison,
	isExpectedPartial,
	type GradePacket,
} from "./grader.ts";

type Case = (typeof comparisonCases)[number];

function draft(
	testCase: Case,
	sources: readonly { url: string; evidence: string }[],
) {
	const rows = testCase.fixture.rows.map((row) =>
		row.kind === "known"
			? `${row.id} = ${row.value}${row.unit}`
			: `${row.id} = 不明`,
	);
	const limitations = testCase.fixture.rows.flatMap((row) =>
		row.kind === "unknown" ? [row.limitation] : [],
	);
	return {
		title: "補給量",
		completion:
			testCase.fixture.expectedOutcome === "completed"
				? ("complete" as const)
				: ("incomplete" as const),
		answer: [
			...rows.map(
				(line, i) => `${line} [公式記録](${testCase.fixture.rows[i]!.url})`,
			),
			...limitations,
		].join("\n"),
		summary: "公式記録の照合結果",
		stopReason: "照合結果を保存",
		limitations,
		claims: testCase.fixture.rows.map((row, i) => ({
			text: rows[i]!,
			status:
				row.kind === "known" ? ("verified" as const) : ("unknown" as const),
			evidence:
				row.kind === "known"
					? [sources.find((source) => source.url === row.url)!.evidence]
					: [],
		})),
	};
}

function packet(testCase = comparisonCases[0]!) {
	const evidence = testCase.documents.map((doc, i) => ({
		url: doc.url,
		evidence: `e${i + 1}`,
		excerpts: [{ text: doc.text }],
	}));
	return { report: draft(testCase, evidence), evidence, markdownSave: null };
}

test("grader passes known values and explicit unknown when the request allows completion", () => {
	for (const c of comparisonCases.slice(0, 2))
		expect(gradeComparison(c.fixture, packet(c)).passed).toBe(true);
});

test("grader keeps required missing material ineligible for full acceptance", () => {
	const c = comparisonCases[2]!;
	const p = packet(c);
	expect(
		gradeComparison(c.fixture, {
			...p,
			report: { ...p.report, completion: "complete" },
		}),
	).toMatchObject({ passed: false, failure: "missing_evidence" });
});

test("grader returns the specific source when an otherwise correct row was clipped", () => {
	const c = comparisonCases[0]!;
	const p = packet(c);
	p.evidence[1]!.excerpts[0]!.text = "補給記録";
	expect(gradeComparison(c.fixture, p)).toMatchObject({
		passed: false,
		failure: "missing_evidence",
		missingEvidence: ["e2"],
	});
});

test.each([
	[
		"wrong value",
		(p: ReturnType<typeof packet>) => {
			p.report.answer = p.report.answer.replace("21.4 L", "21.5 L");
			p.report.claims[0]!.text = "F11 = 21.5 L";
		},
	],
	[
		"wrong unit",
		(p: ReturnType<typeof packet>) => {
			p.report.answer = p.report.answer.replace("21.4 L", "21.4 mL");
			p.report.claims[0]!.text = "F11 = 21.4 mL";
		},
	],
	[
		"swapped URL",
		(p: ReturnType<typeof packet>) => {
			p.report.answer = p.report.answer.replace(
				p.evidence[0]!.url,
				p.evidence[1]!.url,
			);
		},
	],
	[
		"cyclically swapped citation IDs",
		(p: ReturnType<typeof packet>) => {
			p.report.claims.forEach((claim, i) => {
				claim.evidence = [p.evidence[(i + 1) % p.evidence.length]!.evidence];
			});
		},
	],
	[
		"correct and wrong values both present",
		(p: ReturnType<typeof packet>) => {
			p.report.answer += `\nF11 = 99.9 L [公式記録](${p.evidence[0]!.url})`;
		},
	],
	[
		"wrong claim text with correct body",
		(p: ReturnType<typeof packet>) => {
			p.report.claims[0]!.text = "F11 = 99.9 L";
		},
	],
] as const)("grader rejects %s", (_name, mutate) => {
	const p = packet();
	mutate(p);
	expect(gradeComparison(comparisonCases[0]!.fixture, p)).toMatchObject({
		passed: false,
		failure: "nonconforming",
	});
});

test("grader rejects an unknown marked verified, or missing limitations", () => {
	const c = comparisonCases[1]!;
	const p = packet(c);
	const bad = {
		...p.report.claims.at(-1)!,
		status: "verified" as const,
		evidence: ["e1"],
	};
	expect(
		gradeComparison(c.fixture, {
			...p,
			report: { ...p.report, claims: [...p.report.claims.slice(0, -1), bad] },
		}).passed,
	).toBe(false);
	expect(
		gradeComparison(c.fixture, {
			...p,
			report: { ...p.report, limitations: [] },
		}).passed,
	).toBe(false);
	expect(
		gradeComparison(c.fixture, {
			...p,
			report: {
				...p.report,
				answer: p.report.answer.split("\n").slice(0, -1).join("\n"),
			},
		}).passed,
	).toBe(false);
});

test("grader counts only a review of the current version when required", () => {
	const p = packet();
	const fixture = {
		...comparisonCases[0]!.fixture,
		requiresCurrentReview: true as const,
	};
	expect(
		gradeComparison(fixture, {
			...p,
			reportReviews: [{ reportDigest: hash({ ...p.report, summary: "旧版" }) }],
		}).passed,
	).toBe(false);
	expect(
		gradeComparison(fixture, {
			...p,
			reportReviews: [{ reportDigest: hash(p.report) }],
		}).passed,
	).toBe(true);
});

const action = (tool: string, input: object, expectedStatus = "ok") => ({
	tool,
	inputJson: JSON.stringify(input),
	text: null,
	expectedStatus,
	expectedObservation: "対象の本文または保存結果を受領する",
	whatChanged: "公式記録の照合を進める",
	refutedIf: "対象の本文または保存結果が得られない",
});

test.each(comparisonCases)("host integration: $id", async (c) => {
	const directory = await mkdtemp(join(tmpdir(), "solver-comparison-"));
	const base = scripted("museum");
	let finalPacket: GradePacket | undefined;
	const host = await openExample({
		directory,
		request: c.request,
		execution: "productive",
		async web(request) {
			const { url } = request.arguments as { url?: string };
			const document = c.documents.find((doc) => doc.url === url);
			return document
				? { state: "finished", hits: [], documents: [document], failures: [] }
				: {
						state: "failed",
						code: "fixture_unavailable",
						hits: [],
						documents: [],
						failures: [],
					};
		},
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose === "grade") {
					finalPacket = JSON.parse(
						JSON.parse(request.prompt).state,
					) as GradePacket;
					return {
						...response,
						value: request.schema.parse(
							gradeComparison(c.fixture, finalPacket),
						),
					};
				}
				if (request.purpose !== "propose") return response;
				const packet = JSON.parse(request.prompt);
				const state = JSON.parse(packet.state.split("\n\n").at(-1));
				if (state.pending.length) return response;
				if (!state.attempts.length)
					return {
						...response,
						value: request.schema.parse({
							...(response.value as object),
							waitAfterDispatch: true,
							actions: c.fixture.rows.map((row) =>
								action(
									"web_read",
									{ url: row.url },
									row.kind === "known" ? "ok" : "error",
								),
							),
						}),
					};
				return {
					...response,
					value: request.schema.parse({
						...(response.value as object),
						choice:
							c.fixture.expectedOutcome === "completed"
								? "complete"
								: "partial",
						sequence: true,
						waitAfterDispatch: false,
						actions: [
							action("report_draft", draft(c, packet.sources)),
							action("report_read", {}),
						],
					}),
				};
			},
		},
	});
	try {
		const { view, markdown } = await host.drive();
		expect(view.status).toBe(c.fixture.expectedOutcome);
		expect(view.report?.verified).toBe(
			c.fixture.expectedOutcome === "completed",
		);
		expect(finalPacket).toBeDefined();
		expect(await Bun.file(markdown!).text()).toBe(finalPacket!.report.answer);
		if (c.fixture.expectedOutcome === "incomplete") {
			expect(isExpectedPartial(c.fixture, finalPacket!, view)).toBe(true);
			expect(
				isExpectedPartial(c.fixture, finalPacket!, {
					...view,
					attempts: view.attempts.filter(
						(attempt) => attempt.tool !== "report_read",
					),
				}),
			).toBe(false);
			expect(
				isExpectedPartial(c.fixture, finalPacket!, {
					...view,
					decisions: [],
				}),
			).toBe(false);
			expect(
				isExpectedPartial(
					c.fixture,
					{ ...finalPacket!, markdownSave: null },
					view,
				),
			).toBe(false);
		}
	} finally {
		await host.close();
		await rm(directory, { recursive: true, force: true });
	}
});
