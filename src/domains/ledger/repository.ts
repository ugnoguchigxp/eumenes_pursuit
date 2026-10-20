import {
	expectChanges,
	LedgerIntegrityError,
	requireTransaction,
	RevisionConflictError,
	startInputSchema,
	type DecidedBy,
	type DecisionKind,
	type JsonObject,
	type LedgerDb,
	type PursuitStatus,
	type Report,
	type VersionRef,
} from "../../contracts/index.ts";
import type {
	AcceptanceRow,
	AttemptFeatures,
	AttemptRow,
	ConsultationRow,
	DecisionRow,
	HypothesisRow,
	InferenceRow,
	JudgementRow,
	Observation,
	Prediction,
	PursuitView,
	Rejection,
	StrategyRow,
	VerificationRow,
} from "./types.ts";
import { loadFindings } from "./findings.ts";

type Row = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const nullable = <T>(value: unknown): T | null =>
	value === null || value === undefined ? null : parse<T>(value);
const text = (value: unknown) => String(value);
const textOrNull = (value: unknown) =>
	value === null || value === undefined ? null : String(value);

function nextSeq(db: LedgerDb, table: string, pursuitId: string): number {
	const row = db
		.query(
			`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM ${table} WHERE pursuit_id = ?`,
		)
		.get(pursuitId) as { seq: number };
	return row.seq;
}

export function insertPursuit(
	db: LedgerDb,
	input: {
		id: string;
		start: unknown;
		status: PursuitStatus;
		now: number;
	},
): void {
	requireTransaction(db);
	const start = startInputSchema.parse(input.start);
	db.query(
		`INSERT INTO pursuit_pursuit (id, goal, status, revision, input_json, started_at, updated_at)
		 VALUES (?, ?, ?, 1, ?, ?, ?)`,
	).run(input.id, start.goal, input.status, json(start), input.now, input.now);
	start.acceptance.forEach((criterion, index) => {
		db.query(
			`INSERT INTO pursuit_acceptance (pursuit_id, criterion_id, seq, text, method, frozen_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			input.id,
			criterion.id,
			index + 1,
			criterion.text,
			criterion.method,
			input.now,
		);
	});
}

/** Bump the revision; every mutating step goes through this exactly once. */
export function advancePursuit(
	db: LedgerDb,
	input: {
		id: string;
		expectedRevision: number;
		now: number;
		status?: PursuitStatus;
		currentStrategyId?: string | null;
		currentHypothesisId?: string | null;
		finished?: boolean;
	},
): number {
	requireTransaction(db);
	const current = db
		.query("SELECT revision FROM pursuit_pursuit WHERE id = ?")
		.get(input.id) as { revision: number } | null;
	if (!current) throw new LedgerIntegrityError("pursuit_missing");
	if (current.revision !== input.expectedRevision)
		throw new RevisionConflictError(input.expectedRevision, current.revision);
	const sets = ["revision = revision + 1", "updated_at = ?"];
	const params: (string | number | null)[] = [input.now];
	if (input.status !== undefined) {
		sets.push("status = ?");
		params.push(input.status);
	}
	if (input.currentStrategyId !== undefined) {
		sets.push("current_strategy_id = ?");
		params.push(input.currentStrategyId);
	}
	if (input.currentHypothesisId !== undefined) {
		sets.push("current_hypothesis_id = ?");
		params.push(input.currentHypothesisId);
	}
	if (input.finished) {
		sets.push("finished_at = ?");
		params.push(input.now);
	}
	expectChanges(
		db
			.query(
				`UPDATE pursuit_pursuit SET ${sets.join(", ")} WHERE id = ? AND revision = ?`,
			)
			.run(...params, input.id, input.expectedRevision),
		1,
		"pursuit_advance",
	);
	return input.expectedRevision + 1;
}

export function insertStrategy(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		body: string;
		rationale: string;
		alternatives: readonly string[];
		previousId: string | null;
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_strategy (id, pursuit_id, seq, body, rationale, alternatives_json, status, previous_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		nextSeq(db, "pursuit_strategy", input.pursuitId),
		input.body,
		input.rationale,
		json(input.alternatives),
		input.previousId,
		input.now,
	);
}

export function closeStrategy(
	db: LedgerDb,
	input: { id: string; reason: string; now: number },
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE pursuit_strategy SET status = 'closed', close_reason = ?, closed_at = ? WHERE id = ? AND status = 'active'",
			)
			.run(input.reason, input.now, input.id),
		1,
		"strategy_close",
	);
}

export function insertHypothesis(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		strategyId: string;
		body: string;
		rationale: string;
		tools: readonly string[];
		expected: string;
		budget: number;
		checkpoint: string | null;
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_hypothesis (id, pursuit_id, strategy_id, seq, body, rationale, tools_json, expected, budget, checkpoint, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
	).run(
		input.id,
		input.pursuitId,
		input.strategyId,
		nextSeq(db, "pursuit_hypothesis", input.pursuitId),
		input.body,
		input.rationale,
		json(input.tools),
		input.expected,
		input.budget,
		input.checkpoint,
		input.now,
	);
}

export function closeHypothesis(
	db: LedgerDb,
	input: { id: string; result: string; now: number },
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE pursuit_hypothesis SET status = 'closed', result = ?, closed_at = ? WHERE id = ? AND status = 'active'",
			)
			.run(input.result, input.now, input.id),
		1,
		"hypothesis_close",
	);
}

export function insertAttempt(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		hypothesisId: string;
		state: "rejected" | "started";
		tool: string;
		input: JsonObject;
		prediction: Prediction;
		whatChanged: string;
		fingerprint: string;
		rejection: readonly Rejection[] | null;
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_attempt (id, pursuit_id, hypothesis_id, seq, state, tool, input_json, prediction_json, what_changed, fingerprint, rejection_json, refs_json, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
	).run(
		input.id,
		input.pursuitId,
		input.hypothesisId,
		nextSeq(db, "pursuit_attempt", input.pursuitId),
		input.state,
		input.tool,
		json(input.input),
		json(input.prediction),
		input.whatChanged,
		input.fingerprint,
		input.rejection === null ? null : json(input.rejection),
		input.now,
	);
}

export function settleAttempt(
	db: LedgerDb,
	input: {
		id: string;
		observation: Observation;
		outcome: "success" | "failure";
		refs: AttemptRow["refs"];
		features: AttemptFeatures;
		now: number;
	},
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				`UPDATE pursuit_attempt SET state = 'settled', observation_json = ?, outcome = ?, refs_json = ?, features_json = ?, settled_at = ?
				 WHERE id = ? AND state = 'started'`,
			)
			.run(
				json(input.observation),
				input.outcome,
				json(input.refs),
				json(input.features),
				input.now,
				input.id,
			),
		1,
		"attempt_settle",
	);
}

/** A started attempt whose result never arrived (crash, abort). */
export function interruptAttempt(
	db: LedgerDb,
	input: { id: string; now: number },
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE pursuit_attempt SET state = 'interrupted', outcome = 'failure', settled_at = ? WHERE id = ? AND state = 'started'",
			)
			.run(input.now, input.id),
		1,
		"attempt_interrupt",
	);
}

export function updateAttemptFeatures(
	db: LedgerDb,
	input: {
		id: string;
		features: AttemptFeatures;
		outcome: "success" | "failure";
	},
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE pursuit_attempt SET features_json = ?, outcome = ? WHERE id = ? AND state = 'settled'",
			)
			.run(json(input.features), input.outcome, input.id),
		1,
		"attempt_features",
	);
}

export function insertJudgements(
	db: LedgerDb,
	input: {
		ids: readonly string[];
		pursuitId: string;
		rows: readonly JudgementRow[];
		now: number;
	},
): void {
	requireTransaction(db);
	if (input.ids.length !== input.rows.length)
		throw new LedgerIntegrityError("judgement_ids");
	input.rows.forEach((row, index) => {
		db.query(
			`INSERT INTO pursuit_judgement (id, pursuit_id, attempt_id, stage, question_set_id, question_set_version, question_id, answer_json, threshold, fired, usable, model, adapter_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			input.ids[index]!,
			input.pursuitId,
			row.attemptId,
			row.stage,
			row.questionSet.id,
			row.questionSet.version,
			row.questionId,
			json(row.answer),
			row.threshold,
			row.fired ? 1 : 0,
			row.usable ? 1 : 0,
			row.model,
			row.adapter === null ? null : json(row.adapter),
			input.now,
		);
	});
}

export function insertDecision(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		kind: DecisionKind;
		reason: string;
		basis: JsonObject;
		decidedBy: DecidedBy;
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_decision (id, pursuit_id, seq, kind, reason, basis_json, decided_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		nextSeq(db, "pursuit_decision", input.pursuitId),
		input.kind,
		input.reason,
		json(input.basis),
		input.decidedBy,
		input.now,
	);
}

export function insertConsultation(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		question: string;
		missing: string;
		options: readonly string[];
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_consultation (id, pursuit_id, question, missing, options_json, asked_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		input.question,
		input.missing,
		json(input.options),
		input.now,
	);
}

export function answerConsultation(
	db: LedgerDb,
	input: { id: string; pursuitId: string; answer: string; now: number },
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE pursuit_consultation SET answer = ?, answered_at = ? WHERE id = ? AND pursuit_id = ? AND answer IS NULL",
			)
			.run(input.answer, input.now, input.id, input.pursuitId),
		1,
		"consultation_answer",
	);
}

export function insertVerification(
	db: LedgerDb,
	input: {
		id: string;
		pursuitId: string;
		row: VerificationRow;
		now: number;
	},
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_verification (id, pursuit_id, attempt_id, trigger, passed, criteria_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		input.row.attemptId,
		input.row.trigger,
		input.row.passed ? 1 : 0,
		json(input.row.criteria),
		input.now,
	);
}

export function insertInference(
	db: LedgerDb,
	input: { id: string; pursuitId: string; row: InferenceRow; now: number },
): void {
	requireTransaction(db);
	db.query(
		`INSERT INTO pursuit_inference (id, pursuit_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, latency_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.pursuitId,
		input.row.purpose,
		input.row.model,
		input.row.inputTokens,
		input.row.outputTokens,
		input.row.cacheReadTokens,
		Math.round(input.row.latencyMs),
		input.now,
	);
}

export function insertReport(
	db: LedgerDb,
	input: { pursuitId: string; report: Report; now: number },
): void {
	requireTransaction(db);
	db.query(
		"INSERT INTO pursuit_report (pursuit_id, report_json, created_at) VALUES (?, ?, ?)",
	).run(input.pursuitId, json(input.report), input.now);
}

/**
 * Operation replay: the same key with the same digest returns the stored pursuit,
 * a different digest is a conflict, an unknown key is recorded.
 */
export function claimOperation(
	db: LedgerDb,
	input: {
		key: string;
		kind: string;
		digest: string;
		pursuitId: string;
		now: number;
	},
): { replayed: false } | { replayed: true; pursuitId: string } {
	requireTransaction(db);
	const existing = db
		.query(
			"SELECT kind, digest, pursuit_id FROM pursuit_operation WHERE operation_key = ?",
		)
		.get(input.key) as Row | null;
	if (existing) {
		if (existing.kind !== input.kind || existing.digest !== input.digest)
			throw new LedgerIntegrityError("operation_conflict");
		return { replayed: true, pursuitId: text(existing.pursuit_id) };
	}
	db.query(
		"INSERT INTO pursuit_operation (operation_key, kind, digest, pursuit_id, created_at) VALUES (?, ?, ?, ?, ?)",
	).run(input.key, input.kind, input.digest, input.pursuitId, input.now);
	return { replayed: false };
}

export function listPursuitIds(
	db: LedgerDb,
	filter: { statuses?: readonly PursuitStatus[] } = {},
): string[] {
	const rows = (
		filter.statuses?.length
			? db
					.query(
						`SELECT id FROM pursuit_pursuit WHERE status IN (${filter.statuses.map(() => "?").join(", ")}) ORDER BY started_at`,
					)
					.all(...filter.statuses)
			: db.query("SELECT id FROM pursuit_pursuit ORDER BY started_at").all()
	) as Row[];
	return rows.map((row) => text(row.id));
}

export function loadPursuit(db: LedgerDb, id: string): PursuitView | null {
	const p = db
		.query("SELECT * FROM pursuit_pursuit WHERE id = ?")
		.get(id) as Row | null;
	if (!p) return null;
	const all = (sql: string) => db.query(sql).all(id) as Row[];
	const acceptance: AcceptanceRow[] = all(
		"SELECT * FROM pursuit_acceptance WHERE pursuit_id = ? ORDER BY seq",
	).map((r) => ({
		id: text(r.criterion_id),
		text: text(r.text),
		method: r.method as AcceptanceRow["method"],
	}));
	const strategies: StrategyRow[] = all(
		"SELECT * FROM pursuit_strategy WHERE pursuit_id = ? ORDER BY seq",
	).map((r) => ({
		id: text(r.id),
		seq: Number(r.seq),
		body: text(r.body),
		rationale: text(r.rationale),
		alternatives: parse<string[]>(r.alternatives_json),
		status: r.status as StrategyRow["status"],
		closeReason: textOrNull(r.close_reason),
		previousId: textOrNull(r.previous_id),
	}));
	const hypotheses: HypothesisRow[] = all(
		"SELECT * FROM pursuit_hypothesis WHERE pursuit_id = ? ORDER BY seq",
	).map((r) => ({
		id: text(r.id),
		strategyId: text(r.strategy_id),
		seq: Number(r.seq),
		body: text(r.body),
		rationale: text(r.rationale),
		tools: parse<string[]>(r.tools_json),
		expected: text(r.expected),
		budget: Number(r.budget),
		checkpoint: textOrNull(r.checkpoint),
		status: r.status as HypothesisRow["status"],
		result: textOrNull(r.result),
	}));
	const attempts: AttemptRow[] = all(
		"SELECT * FROM pursuit_attempt WHERE pursuit_id = ? ORDER BY seq",
	).map((r) => ({
		id: text(r.id),
		hypothesisId: text(r.hypothesis_id),
		seq: Number(r.seq),
		state: r.state as AttemptRow["state"],
		tool: text(r.tool),
		input: parse<JsonObject>(r.input_json),
		prediction: parse<Prediction>(r.prediction_json),
		whatChanged: text(r.what_changed),
		fingerprint: text(r.fingerprint),
		rejection: nullable<Rejection[]>(r.rejection_json),
		observation: nullable<Observation>(r.observation_json),
		outcome: (r.outcome ?? null) as AttemptRow["outcome"],
		refs: parse<AttemptRow["refs"]>(r.refs_json),
		features: nullable<AttemptFeatures>(r.features_json),
	}));
	const judgements: JudgementRow[] = all(
		"SELECT * FROM pursuit_judgement WHERE pursuit_id = ? ORDER BY created_at, rowid",
	).map((r) => ({
		attemptId: textOrNull(r.attempt_id),
		stage: r.stage as JudgementRow["stage"],
		questionSet: {
			id: text(r.question_set_id),
			version: Number(r.question_set_version),
		},
		questionId: text(r.question_id),
		answer: parse<JudgementRow["answer"]>(r.answer_json),
		threshold: Number(r.threshold),
		fired: r.fired === 1,
		usable: r.usable === 1,
		model: text(r.model),
		adapter: nullable<VersionRef>(r.adapter_json),
	}));
	const decisions: DecisionRow[] = all(
		"SELECT * FROM pursuit_decision WHERE pursuit_id = ? ORDER BY seq",
	).map((r) => ({
		seq: Number(r.seq),
		kind: r.kind as DecisionKind,
		reason: text(r.reason),
		basis: parse<JsonObject>(r.basis_json),
		decidedBy: r.decided_by as DecidedBy,
	}));
	const consultations: ConsultationRow[] = all(
		"SELECT * FROM pursuit_consultation WHERE pursuit_id = ? ORDER BY asked_at, rowid",
	).map((r) => ({
		id: text(r.id),
		question: text(r.question),
		missing: text(r.missing),
		options: parse<string[]>(r.options_json),
		answer: textOrNull(r.answer),
		askedAt: Number(r.asked_at),
		answeredAt:
			r.answered_at === null || r.answered_at === undefined
				? null
				: Number(r.answered_at),
	}));
	const verifications: VerificationRow[] = all(
		"SELECT * FROM pursuit_verification WHERE pursuit_id = ? ORDER BY created_at, rowid",
	).map((r) => ({
		attemptId: textOrNull(r.attempt_id),
		trigger: r.trigger as VerificationRow["trigger"],
		passed: r.passed === 1,
		criteria: parse<VerificationRow["criteria"]>(r.criteria_json),
	}));
	const inference: InferenceRow[] = all(
		"SELECT * FROM pursuit_inference WHERE pursuit_id = ? ORDER BY created_at, rowid",
	).map((r) => ({
		purpose: text(r.purpose),
		model: text(r.model),
		inputTokens: Number(r.input_tokens),
		outputTokens: Number(r.output_tokens),
		cacheReadTokens: Number(r.cache_read_tokens),
		latencyMs: Number(r.latency_ms),
	}));
	const report = db
		.query("SELECT report_json FROM pursuit_report WHERE pursuit_id = ?")
		.get(id) as Row | null;
	return {
		id: text(p.id),
		goal: text(p.goal),
		status: p.status as PursuitStatus,
		revision: Number(p.revision),
		input: startInputSchema.parse(parse(p.input_json)),
		currentStrategyId: textOrNull(p.current_strategy_id),
		currentHypothesisId: textOrNull(p.current_hypothesis_id),
		startedAt: Number(p.started_at),
		updatedAt: Number(p.updated_at),
		acceptance,
		strategies,
		hypotheses,
		attempts,
		judgements,
		decisions,
		consultations,
		verifications,
		inference,
		report: report ? parse<Report>(report.report_json) : null,
		findings: loadFindings(db, id),
	};
}
