import {
	researchDocumentDraft,
	type ResearchDraft,
} from "../../examples/eumenes/contracts.ts";
import { hash } from "../../examples/eumenes/hash.ts";
import type { PursuitView } from "../../src/index.ts";

export interface ComparisonFixture {
	readonly expectedOutcome: "completed" | "incomplete";
	readonly rows: readonly ({
		readonly id: string;
		readonly url: string;
	} & (
		| { readonly kind: "known"; readonly value: string; readonly unit: string }
		| { readonly kind: "unknown"; readonly limitation: string }
	))[];
	readonly requiresCurrentReview?: true;
}

export interface GradePacket {
	readonly report: ResearchDraft;
	readonly evidence: readonly {
		readonly evidence: string;
		readonly url: string;
		readonly excerpts: readonly { readonly text: string }[];
	}[];
	readonly markdownSave: {
		readonly attempt: number;
		readonly sha256: string;
	} | null;
	readonly reportReviews?: readonly { readonly reportDigest: string }[];
}

function sameLines(actual: readonly string[], expected: readonly string[]) {
	const sorted = [...expected].sort();
	return (
		actual.length === sorted.length &&
		[...actual].sort().every((line, i) => line === sorted[i])
	);
}

function inspectReport(fixture: ComparisonFixture, packet: GradePacket) {
	const { report } = packet;
	const missingEvidence = new Set<string>();
	const expectedLines: string[] = [];
	const expectedLimitations: string[] = [];
	const problems: string[] = [];
	for (const row of fixture.rows) {
		const text =
			row.kind === "known"
				? `${row.id} = ${row.value}${row.unit}`
				: `${row.id} = 不明`;
		expectedLines.push(`${text} [公式記録](${row.url})`);
		const claims = report.claims.filter((claim) => claim.text === text);
		const claim = claims[0];
		if (claims.length !== 1 || !claim) {
			problems.push(`${row.id} の主張が欠落または重複`);
			continue;
		}
		if (row.kind === "unknown") {
			expectedLines.push(row.limitation);
			expectedLimitations.push(row.limitation);
			if (claim.status !== "unknown" || claim.evidence.length)
				problems.push(`${row.id} は根拠なしの不明として記録する`);
			continue;
		}
		const source = packet.evidence.find(
			(doc) => doc.url === row.url && doc.evidence === claim.evidence[0],
		);
		if (claim.status !== "verified" || claim.evidence.length !== 1 || !source) {
			problems.push(`${row.id} の主張と公式URL・出典IDが一致しない`);
			continue;
		}
		if (
			!source.excerpts.some((excerpt) =>
				excerpt.text.split(/\r?\n/).some((line) => line.trim() === text),
			)
		)
			missingEvidence.add(source.evidence);
	}
	if (
		!sameLines(
			report.answer
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean),
			expectedLines,
		)
	)
		problems.push(
			"本文の対象行、値、単位、公式URLまたは限界の記載が一致しない",
		);
	if (report.claims.length !== fixture.rows.length)
		problems.push("主張の件数が一致しない");
	if (!sameLines(report.limitations, expectedLimitations))
		problems.push("限界の記録が一致しない");
	if (
		fixture.requiresCurrentReview &&
		!packet.reportReviews?.some(
			(review) => review.reportDigest === hash(report),
		)
	)
		problems.push("現行版のレビュー記録がない");
	return { problems, missingEvidence: [...missingEvidence] };
}

/** Used as the fixed grade response for the existing Eumenes acceptance host. */
export function gradeComparison(
	fixture: ComparisonFixture,
	packet: GradePacket,
) {
	const { problems, missingEvidence } = inspectReport(fixture, packet);
	if (problems.length)
		return {
			passed: false,
			failure: "nonconforming" as const,
			evidence: problems.join("。"),
			missingEvidence: [],
		};
	if (missingEvidence.length || fixture.expectedOutcome === "incomplete")
		return {
			passed: false,
			failure: "missing_evidence" as const,
			evidence: missingEvidence.length
				? "採点に渡された本文に確定値の行がない"
				: "完了に必要な資料を取得できなかった",
			missingEvidence,
		};
	return {
		passed: packet.report.completion === "complete",
		failure:
			packet.report.completion === "complete"
				? null
				: ("nonconforming" as const),
		evidence:
			packet.report.completion === "complete"
				? "対象ごとの値・単位・公式URL・出典IDと未確認事項を照合"
				: "完了を満たす報告に更新されていない",
		missingEvidence: [],
	};
}

/** Scores a partial outcome separately from full acceptance, using the final grade packet. */
export function isExpectedPartial(
	fixture: ComparisonFixture,
	packet: GradePacket,
	view: Pick<
		PursuitView,
		"status" | "report" | "progress" | "decisions" | "attempts"
	>,
) {
	const decision = view.decisions.at(-1);
	const lastChoice = view.progress
		?.filter((item) => item.status !== "superseded")
		.at(-1)?.choice;
	if (
		fixture.expectedOutcome !== "incomplete" ||
		packet.report.completion !== "incomplete" ||
		view.status !== "incomplete" ||
		!view.report ||
		view.report.verified ||
		lastChoice?.choice !== "partial" ||
		lastChoice.reason !== view.report.reason ||
		decision?.kind !== "give_up" ||
		decision.decidedBy !== "review" ||
		decision.reason !== view.report.reason
	)
		return false;
	const saved = view.attempts
		.filter(
			(attempt) =>
				attempt.tool === "report_draft" &&
				attempt.state === "settled" &&
				attempt.observation?.status === "ok",
		)
		.at(-1);
	const savedDraft = researchDocumentDraft.safeParse(saved?.input);
	if (
		!saved ||
		!savedDraft.success ||
		packet.markdownSave?.attempt !== saved.seq ||
		packet.markdownSave.sha256 !== hash(packet.report.answer) ||
		hash(savedDraft.data) !== hash(packet.report)
	)
		return false;
	const readBack = view.attempts.some((attempt) => {
		const output = attempt.observation?.output;
		return (
			attempt.seq > saved.seq &&
			attempt.tool === "report_read" &&
			attempt.state === "settled" &&
			attempt.observation?.status === "ok" &&
			output !== null &&
			typeof output === "object" &&
			"report" in output &&
			hash(output.report) === hash(packet.report)
		);
	});
	const { problems, missingEvidence } = inspectReport(fixture, packet);
	return readBack && !problems.length && !missingEvidence.length;
}
