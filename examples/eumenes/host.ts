import { Database } from "bun:sqlite";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	createPursuitEngine,
	policySchema,
	terminalStatuses,
	type JsonValue,
	type LlmPort,
	type LlmResult,
	type PursuitEngine,
	type StartInput,
	type StepResult,
	type ToolOutcome,
} from "../../src/index.ts";
import {
	findPursuitByOperation,
	migrations,
	type MigrationDescriptor,
} from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { acceptance, criteria } from "./acceptance.ts";
import { current, type Context, type WebRequest } from "./context.ts";
import { researchDocumentDraft } from "./contracts.ts";
import { documentName } from "./document-name.ts";
import {
	evaluatorModel,
	reportReviewInput,
	reportReviewTool,
	reviewReport,
} from "./evaluator.ts";
import { hash } from "./hash.ts";
import { localMarkdown } from "./markdown-write.ts";
import { model, type Log } from "./model.ts";
import {
	documents,
	rowOf,
	save,
	stateOf,
	type Row,
	type State,
} from "./repository.ts";
import {
	prepareSteering,
	SteeringReferenceRevoked,
	type SteeringOptions,
	type SteeringReference,
} from "./steering.ts";
import { researchTools } from "./tools.ts";
import instructions from "./instructions.json";
import policy from "./policy.json";

export interface WebResult {
	state: "finished" | "failed";
	code?: string;
	hits: JsonValue[];
	documents: {
		url: string;
		title: string;
		text: string;
		fetchedAt: number;
		truncated: boolean;
	}[];
	failures: JsonValue[];
}
export interface HostOptions {
	directory: string;
	request: string;
	execution: "legacy" | "productive";
	generator: LlmPort;
	reviewer?: LlmPort;
	evaluator?: LlmPort;
	web(request: WebRequest, signal: AbortSignal): Promise<WebResult>;
	log?: Log;
	wallMs?: number;
	markdownDelayMs?: number;
	steering?: SteeringOptions;
	limits?: State["limits"];
	baseline?: {
		create: typeof createPursuitEngine;
		migrations: readonly MigrationDescriptor[];
	};
}
type Job = {
	id: string;
	kind: "lookup" | "read" | "markdown" | "decision" | "evaluation";
	attempt_id: string | null;
	state: "queued" | "running" | "ready" | "adopted" | "abandoned";
	input: string;
	result: string | null;
};
const id = () => crypto.randomUUID();
const run = "example",
	epoch = 1;
const sql = `
CREATE TABLE IF NOT EXISTS pursuit_runs(id TEXT PRIMARY KEY,epoch INTEGER,core_id TEXT,job_id TEXT,deadline INTEGER,closed INTEGER DEFAULT 0,data_json TEXT,updated_at INTEGER);
CREATE TABLE IF NOT EXISTS pursuit_web_operations(id TEXT PRIMARY KEY,run_id TEXT,epoch INTEGER,attempt_id TEXT,external_id TEXT,job_id TEXT,outcome_json TEXT);
CREATE TABLE IF NOT EXISTS pursuit_documents(run_id TEXT,epoch INTEGER,id TEXT,url TEXT,title TEXT,text TEXT,fetched_at INTEGER,truncated INTEGER,PRIMARY KEY(run_id,epoch,id));
CREATE TABLE IF NOT EXISTS example_jobs(id TEXT PRIMARY KEY,kind TEXT,attempt_id TEXT,state TEXT,input TEXT,result TEXT);
CREATE TABLE IF NOT EXISTS example_config(fingerprint TEXT PRIMARY KEY);
`;

export async function openExample(options: HostOptions) {
	const steer = options.steering;
	if (options.evaluator && options.execution !== "productive")
		throw new Error("example_evaluator_requires_productive");
	if (steer && (options.execution !== "productive" || options.baseline))
		throw new Error("example_steering_requires_productive");
	if (
		steer &&
		(!Number.isSafeInteger(steer.maxSupplementBytes) ||
			steer.maxSupplementBytes < 0)
	)
		throw new Error("example_invalid_steering_budget");
	const directory = resolve(options.directory);
	await mkdir(join(directory, "private"), { recursive: true });
	const staged = (jobId: string) => join(directory, "private", jobId + ".md");
	const database = join(directory, "example.sqlite");
	const raw = openStore(database, options.baseline?.migrations ?? migrations);
	const reader = new Database(database, { readonly: true, strict: true });
	const wallMs = options.wallMs ?? 1_800_000;
	const limits = options.limits ?? {
		modelCalls: 80,
		childCalls: 24,
		searches: 8,
	};
	const log = options.log ?? (() => {});
	const state: State = {
		source: { request: options.request, amendments: [], responses: [] },
		request: options.request,
		instructions: instructions.body,
		references: [],
		saveDocument: true,
		draft: null,
		snapshots: {},
		modelCalls: 0,
		webCalls: 0,
		searches: 0,
		limits,
		inferenceMs: 120000,
	};
	const signature = hash({
		execution: options.execution,
		request: options.request,
		wallMs,
		limits,
		instructions,
		policy,
		...(options.evaluator ? { evaluator: true } : {}),
		migrations: (options.baseline?.migrations ?? migrations).map(
			(m) => m.sha256,
		),
	});
	const store: Context["store"] = {
		write: <T>(op: (db: Database) => T) =>
			raw.write((db) => op(db as Database) as never) as Promise<T>,
		readSnapshot: (op) => reader.transaction(() => op(reader)).deferred(),
	};
	function validateSteering(
		db: Database,
		row: Row,
		extra: readonly SteeringReference[] = [],
	) {
		const state = stateOf(row);
		if (state.steeringRevoked) throw new SteeringReferenceRevoked();
		const refs = [...(state.steeringReferences ?? []), ...extra];
		if (state.references.length + refs.length > 32)
			throw new SteeringReferenceRevoked();
		for (const ref of refs) {
			try {
				if (row.core_id && steer?.resolve(db, row.core_id, ref) != null)
					continue;
			} catch {
				// A saved decision can only be used while its sources can be checked.
			}
			throw new SteeringReferenceRevoked();
		}
	}
	const put = (
		db: Database,
		jobId: string,
		kind: Job["kind"],
		input: unknown,
		attemptId: string | null,
	) =>
		db
			.query("INSERT INTO example_jobs VALUES (?,?,?,'queued',?,NULL)")
			.run(jobId, kind, attemptId, JSON.stringify(input));
	const ctx: Context = {
		store,
		now: Date.now,
		id,
		validateSteering,
		web: {
			startInTransaction(db, input) {
				put(db, input.requestId, input.kind, input, null);
				return { id: input.requestId, jobId: input.requestId };
			},
		},
		source: () => ({
			validReferenceInTransaction: () => false,
			readReferenceInTransaction() {
				throw new Error("example_has_no_references");
			},
		}),
	};
	try {
		await store.write((db) => {
			db.exec(sql);
			const previous = db
				.query("SELECT fingerprint FROM example_config")
				.get() as { fingerprint: string } | null;
			if (previous && previous.fingerprint !== signature)
				throw new Error("example_resume_input_changed");
			if (!previous) {
				db.query("INSERT INTO example_config VALUES (?)").run(signature);
				db.query(
					"INSERT INTO pursuit_runs(id,epoch,deadline,data_json,updated_at) VALUES(?,?,?,?,?)",
				).run(
					run,
					epoch,
					Date.now() + wallMs,
					JSON.stringify(state),
					Date.now(),
				);
			}
			// A worker whose receipt was not saved is unknown. Do not repeat an external request.
			for (const job of db
				.query("SELECT * FROM example_jobs WHERE state='running'")
				.all() as Job[]) {
				if (job.kind === "markdown") {
					db.query("UPDATE example_jobs SET state='queued' WHERE id=?").run(
						job.id,
					);
				} else if (job.kind === "decision" || job.kind === "evaluation") {
					db.query(
						"UPDATE example_jobs SET state='ready',result=? WHERE id=?",
					).run(
						JSON.stringify({ error: job.kind + "_outcome_unknown" }),
						job.id,
					);
				} else {
					db.query(
						"UPDATE example_jobs SET state='ready',result=? WHERE id=?",
					).run(
						JSON.stringify({
							state: "failed",
							code: "web_outcome_unknown",
							hits: [],
							documents: [],
							failures: [],
						}),
						job.id,
					);
				}
			}
		});
	} catch (error) {
		reader.close();
		raw.close();
		throw error;
	}
	const copied = researchTools(ctx, run, epoch);
	const gen = model(ctx, run, epoch, options.generator, log),
		reviewer = model(
			ctx,
			run,
			epoch,
			options.reviewer ?? options.generator,
			log,
		);
	const evaluator = options.evaluator
		? evaluatorModel(
				model(
					ctx,
					run,
					epoch,
					options.evaluator,
					(event) => log({ ...event, channel: "evaluator_tool" }),
					"native",
				),
			)
		: null;
	const runtime = {
		workspace: copied.workspace,
		acceptance: acceptance(ctx, run, epoch, reviewer, (db, attemptId) => {
			const job = db
				.query<{ id: string; result: string }, [string]>(
					"SELECT id,result FROM example_jobs WHERE kind='markdown' AND attempt_id=? AND state IN ('ready','adopted') AND result IS NOT NULL",
				)
				.get(attemptId);
			return job
				? { path: staged(job.id), receipt: JSON.parse(job.result) }
				: null;
		}),
		tools: {
			...copied.tools,
			list: () => [
				...copied.tools
					.list()
					.map((tool) =>
						tool.name === "report_draft"
							? { ...tool, reuseWriteIgnoring: ["stopReason"] }
							: tool,
					),
				...(evaluator ? [reportReviewTool] : []),
			],
			deferInTransaction: ((db, call, core) => {
				if (call.tool !== "report_draft" && call.tool !== reportReviewTool.name)
					return copied.tools.deferInTransaction!(db, call, core);
				const row = current(ctx, db as Database, run, epoch);
				if (row.core_id !== core.pursuitId)
					throw new Error("pursuit_core_mismatch");
				const operationId = id();
				if (call.tool === reportReviewTool.name) {
					const draft = stateOf(row).draft;
					if (!evaluator || !draft)
						throw new Error("report_review_requires_saved_report");
					const input = reportReviewInput.parse(call.input);
					put(
						db as Database,
						operationId,
						"evaluation",
						{ ...input, reportDigest: hash(draft) },
						core.attemptId,
					);
				} else {
					const draft = researchDocumentDraft.parse(call.input);
					put(db as Database, operationId, "markdown", draft, core.attemptId);
				}
				return { operationId };
			}) as NonNullable<typeof copied.tools.deferInTransaction>,
		},
	};
	let cancellingRevoked = false;
	const engine: PursuitEngine = (
		options.baseline?.create ?? createPursuitEngine
	)({
		store: {
			...raw,
			write: (op) =>
				raw.write((db) => {
					if (!cancellingRevoked)
						validateSteering(db as Database, rowOf(db as Database, run)!);
					return op(db) as never;
				}),
		},
		clock: { now: Date.now },
		ids: { next: (prefix) => prefix + "_" + id() },
		generator: gen,
		reviewer,
		judge: null,
	});
	const initial: StartInput = {
		goal: options.request,
		acceptance: [...criteria],
		grant: ["research"],
		goalRef: null,
		label: "example",
		policy: policySchema.parse({
			...policy,
			budget: { ...policy.budget, wallMs, attempts: limits.childCalls * 3 },
		}),
		conditions: {
			rules: true,
			judge: false,
			review: true,
			questionSet: { id: "pursuit-guards", version: 1 },
			adapter: null,
			language: "ja",
			findings: "all",
			strategyChange: "distinct",
			selfCheck: "parts",
			verifyOn: "claim",
			prediction: "falsifiable",
			completionCheck: "acceptance",
			rollback: "keep",
			verdictLabel: "refutation",
			claimFeedback: "verdict",
			attemptCount: "all",
			...(options.execution === "productive"
				? { execution: "productive" as const }
				: {}),
		},
	};
	const operationKey = "example:start";
	const coreId =
		store.readSnapshot(
			(db) =>
				rowOf(db, run)?.core_id ?? findPursuitByOperation(db, operationKey),
		) ?? (await engine.start(initial, operationKey)).pursuitId;
	await store.write((db) =>
		db.query("UPDATE pursuit_runs SET core_id=? WHERE id=?").run(coreId, run),
	);
	const initialRow = store.readSnapshot((db) => rowOf(db, run)!);
	const scope =
		steer &&
		!initialRow.closed &&
		Date.now() < initialRow.deadline &&
		!terminalStatuses.includes((await engine.view(coreId))!.status)
			? { targetId: `pursuit:${coreId}`, generation: id() }
			: null;
	const opened = scope
		? steer!.inbox.open(scope.targetId, scope.generation)
		: null;
	if (opened && opened.status !== "opened") {
		reader.close();
		raw.close();
		throw new Error(`example_steering_${opened.status}`);
	}
	const steeringTarget = opened?.target;
	const jobs = () =>
		store.readSnapshot(
			(db) =>
				db
					.query(
						"SELECT * FROM example_jobs WHERE state IN ('queued','running','ready') ORDER BY rowid",
					)
					.all() as Job[],
		);
	const active = new Map<string, Promise<void>>();
	const lifecycle = new AbortController();
	const deadline = store.readSnapshot((db) => rowOf(db, run)!.deadline);
	const closeJob = (db: Database, job: Job, status: "adopted" | "abandoned") =>
		db
			.query("UPDATE example_jobs SET state=? WHERE id=? AND state='ready'")
			.run(status, job.id);
	const safeError = (error: unknown) =>
		error instanceof Error ? error.message : "unknown";
	async function execute(job: Job, signal: AbortSignal) {
		await store.write((db) => {
			current(ctx, db, run, epoch);
			const changed = db
				.query(
					"UPDATE example_jobs SET state='running' WHERE id=? AND state='queued'",
				)
				.run(job.id);
			if (changed.changes !== 1) throw new Error("example_job_not_queued");
		});
		const started = performance.now();
		log({ kind: "job_started", job: job.kind, id: job.id });
		let result: unknown;
		let steeringReferences: readonly SteeringReference[] = [];
		try {
			if (job.kind === "decision") {
				const { steeringReferences: refs, ...response } =
					await reviewer.complete(
						await engine.decisionRequest(coreId, job.id),
						signal,
						steer && steeringTarget
							? () =>
									store.readSnapshot((db) => {
										const row = current(ctx, db, run, epoch);
										const state = stateOf(row);
										const presented = state.steeringReferences ?? [];
										return prepareSteering({
											target: steeringTarget,
											boundaryId: job.id,
											now: ctx.now,
											resolve: (ref) => steer.resolve(db, coreId, ref),
											presented,
											remainingReferences:
												32 - state.references.length - presented.length,
											maxSupplementBytes: steer.maxSupplementBytes,
										});
									})
							: undefined,
					);
				steeringReferences = refs ?? [];
				result = response;
			} else if (job.kind === "evaluation") {
				const { question, reportDigest } = JSON.parse(job.input) as {
					question: string;
					reportDigest: string;
				};
				const input = store.readSnapshot((db) => {
					const row = current(ctx, db, run, epoch);
					const { draft, request } = stateOf(row);
					if (!draft || hash(draft) !== reportDigest)
						throw new Error("report_review_stale");
					return {
						pursuitId: coreId,
						request,
						report: draft,
						documents: documents(db, row),
						question,
					};
				});
				if (!evaluator) throw new Error("report_review_unavailable");
				const review = await reviewReport(input, evaluator, signal);
				result = { reportDigest, question, review };
			} else if (job.kind === "markdown") {
				const draft = researchDocumentDraft.parse(JSON.parse(job.input));
				if (options.markdownDelayMs)
					await delay(options.markdownDelayMs, signal);
				const writer = localMarkdown(
					{
						async put(item) {
							const tmp = staged(job.id) + ".tmp";
							await writeFile(tmp, item.data, { signal });
							signal.throwIfAborted();
							await rename(tmp, staged(job.id));
							return { id: item.id };
						},
					},
					(id) => `example-scratch:${id}`,
				);
				const uri = await writer.writeLocal(
					{
						id: job.id,
						conversationId: run,
						title: draft.title,
						markdown: draft.answer,
					},
					signal,
				);
				result = {
					uri,
					title: draft.title,
					hash: hash(draft.answer),
					bytes: Buffer.byteLength(draft.answer),
				};
			} else {
				const request = JSON.parse(job.input) as WebRequest;
				result = await options.web(
					request,
					AbortSignal.any([signal, AbortSignal.timeout(request.timeoutMs)]),
				);
			}
		} catch (error) {
			const code = safeError(error);
			result =
				job.kind === "lookup" || job.kind === "read"
					? { state: "failed", code, hits: [], documents: [], failures: [] }
					: { error: code };
		}
		const saved = await store.write((db) => {
			const row = rowOf(db, run)!;
			if (
				row.closed ||
				row.epoch !== epoch ||
				Date.now() >= row.deadline ||
				lifecycle.signal.aborted
			)
				return false;
			let steeringState: State | undefined;
			if (job.kind === "decision" && steeringReferences.length) {
				steeringState = stateOf(row);
				try {
					validateSteering(db, row, steeringReferences);
					steeringState.steeringReferences = [
						...(steeringState.steeringReferences ?? []),
						...steeringReferences,
					];
				} catch (error) {
					if (!(error instanceof SteeringReferenceRevoked)) throw error;
					steeringState.steeringRevoked = true;
					result = { error: error.message };
				}
			}
			const saved =
				db
					.query(
						"UPDATE example_jobs SET state='ready',result=? WHERE id=? AND state='running'",
					)
					.run(JSON.stringify(result), job.id).changes === 1;
			if (saved && steeringState) save(db, row, steeringState, ctx.now());
			return saved;
		});
		log({
			kind: saved ? "job_ready" : "late_job_ignored",
			job: job.kind,
			id: job.id,
			durationMs: performance.now() - started,
		});
	}
	function launch(signal: AbortSignal) {
		for (const job of jobs()) {
			if (job.state !== "queued" || active.has(job.id)) continue;
			const work = execute(job, signal).finally(() => active.delete(job.id));
			// The drive observes worker errors via the saved outcome or the awaited promise.
			void work.catch(() => {});
			active.set(job.id, work);
		}
	}
	async function adopt(job: Job, signal: AbortSignal): Promise<StepResult> {
		const r = JSON.parse(job.result!);
		if (job.kind === "decision") {
			const step = r.error
				? await engine.cancel(
						coreId,
						`進捗判断の受領に失敗: ${r.error}`,
						runtime,
						signal,
					)
				: await engine.completeDecision(
						coreId,
						job.id,
						r as LlmResult<unknown>,
						runtime,
						signal,
					);
			await store.write((db) => closeJob(db, job, "adopted"));
			return step;
		}
		let attemptId = job.attempt_id;
		let outcome: ToolOutcome;
		if (job.kind === "evaluation") {
			const currentDigest = store.readSnapshot((db) =>
				hash(stateOf(current(ctx, db, run, epoch)).draft),
			);
			const stale = !r.error && r.reportDigest !== currentDigest;
			const error =
				r.error ??
				(stale
					? "report_review_stale"
					: r.review.status === "completed" || r.review.status === "incomplete"
						? null
						: "report_review_" + r.review.status);
			outcome = {
				status: error ? "error" : "ok",
				...(error ? { errorCode: error } : {}),
				output:
					r.error || stale
						? null
						: {
								status: r.review.status,
								findings: r.review.findings,
								reportDigest: r.reportDigest,
								question: r.question,
								issues: r.review.issues,
								unverified: r.review.scopeChecks.filter(
									(entry: { status: string }) => entry.status === "unverified",
								),
								reviewId: r.review.inputDigest,
								trust: "untrusted",
							},
				refs: [],
			};
		} else if (job.kind === "markdown") {
			// Accept the original report_draft operation and its receipt in the same transaction.
			let out = store.readSnapshot(
				(db) =>
					db
						.query("SELECT outcome_json FROM pursuit_web_operations WHERE id=?")
						.get(job.id) as { outcome_json: string } | null,
			);
			if (!out) {
				try {
					if (r.error) throw new Error(r.error);
					const draft = researchDocumentDraft.parse(JSON.parse(job.input));
					if (
						hash(await Bun.file(staged(job.id)).text()) !== r.hash ||
						hash(draft.answer) !== r.hash
					)
						throw new Error("markdown_receipt_mismatch");
					const transactional: Context = {
						...ctx,
						store: {
							...store,
							write: (op) =>
								store.write((db) => {
									const value = op(db);
									db.query(
										"INSERT INTO pursuit_web_operations VALUES(?,?,?,?,?,?,?)",
									).run(
										job.id,
										run,
										epoch,
										attemptId,
										job.id,
										job.id,
										JSON.stringify(value),
									);
									return value;
								}),
						},
					};
					outcome = await researchTools(transactional, run, epoch).tools.invoke(
						{ tool: "report_draft", input: draft },
						signal,
					);
					log({
						kind: "markdown_saved",
						id: job.id,
						hash: r.hash,
						bytes: r.bytes,
						completion: draft.completion,
					});
				} catch (error) {
					outcome = {
						status: "error",
						errorCode: safeError(error),
						output: null,
						refs: [],
					};
				}
				out = { outcome_json: JSON.stringify(outcome) };
			}
			outcome = JSON.parse(out.outcome_json) as ToolOutcome;
		} else {
			const receipt = await store.write((db) => {
				const row = current(ctx, db, run, epoch);
				const op = db
					.query(
						"SELECT attempt_id,outcome_json FROM pursuit_web_operations WHERE id=?",
					)
					.get(job.id) as { attempt_id: string; outcome_json: string | null };
				if (op.outcome_json)
					return {
						attemptId: op.attempt_id,
						outcome: JSON.parse(op.outcome_json) as ToolOutcome,
					};
				const web = r as WebResult;
				let number = documents(db, row).length;
				const acquired = web.documents.map((doc) => {
					const evidence = `e${++number}`;
					db.query("INSERT INTO pursuit_documents VALUES(?,?,?,?,?,?,?,?)").run(
						run,
						epoch,
						evidence,
						doc.url,
						doc.title,
						doc.text,
						doc.fetchedAt,
						doc.truncated ? 1 : 0,
					);
					return {
						evidence,
						...doc,
						text: doc.text.slice(0, 12000),
						totalCharacters: doc.text.length,
						truncated: doc.truncated || doc.text.length > 12000,
						trust: "untrusted",
					};
				});
				const result: ToolOutcome = {
					status: web.state === "finished" ? "ok" : "error",
					...(web.code ? { errorCode: web.code } : {}),
					output: {
						candidates: web.hits,
						documents: acquired,
						failures: web.failures,
					},
					refs: acquired.map((doc) => ({
						kind: "source",
						uri: doc.url,
						note: doc.evidence,
					})),
				};
				db.query(
					"UPDATE pursuit_web_operations SET outcome_json=? WHERE id=? AND outcome_json IS NULL",
				).run(JSON.stringify(result), job.id);
				return { attemptId: op.attempt_id, outcome: result };
			});
			attemptId = receipt.attemptId;
			outcome = receipt.outcome;
		}
		const step = await engine.completeTool(
			coreId,
			attemptId!,
			job.id,
			outcome,
			runtime,
			signal,
		);
		await store.write((db) => closeJob(db, job, "adopted"));
		log({
			kind: "tool_adopted",
			job: job.kind,
			id: job.id,
			attemptId,
			status: outcome.status,
			refs: outcome.refs,
			error: outcome.errorCode,
		});
		return step;
	}

	async function drive(
		signal: AbortSignal = new AbortController().signal,
		pause?: (step: StepResult) => boolean,
	) {
		const timer = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
		const workerSignal = AbortSignal.any([signal, timer, lifecycle.signal]);
		let step: StepResult | undefined;
		let woke: () => void = () => {};
		const aborted = new Promise<void>((resolve) => {
			woke = resolve;
		});
		workerSignal.addEventListener("abort", woke, { once: true });
		try {
			while (true) {
				const view = (await engine.view(coreId))!;
				if (
					terminalStatuses.includes(view.status) ||
					view.status === "awaiting_consultation"
				)
					break;
				try {
					store.readSnapshot((db) => validateSteering(db, rowOf(db, run)!));
					if (workerSignal.aborted) {
						await engine.cancel(
							coreId,
							signal.aborted ? "検証を取り消しました" : "期限に達しました",
							runtime,
							workerSignal,
						);
						break;
					}
					const ready = jobs()
						.filter((j) => j.state === "ready")
						.sort(
							(a, b) =>
								Number(a.kind === "decision") - Number(b.kind === "decision"),
						)[0];
					if (ready) step = await adopt(ready, workerSignal);
					else if (!step || (step.workReady ?? !step.pendingTool))
						step = await engine.step(coreId, runtime, workerSignal);
					else {
						launch(workerSignal);
						if (!active.size)
							throw new Error("example_missing_pending_receipt");
						const began = performance.now();
						await Promise.race([...active.values(), aborted]);
						log({ kind: "wait", durationMs: performance.now() - began });
						continue;
					}
				} catch (error) {
					if (error instanceof SteeringReferenceRevoked) {
						lifecycle.abort(error);
						await store.write((db) => {
							const row = rowOf(db, run)!;
							save(
								db,
								row,
								{ ...stateOf(row), steeringRevoked: true },
								ctx.now(),
							);
						});
						cancellingRevoked = true;
						try {
							await engine.cancel(
								coreId,
								error.message,
								runtime,
								lifecycle.signal,
							);
						} finally {
							cancellingRevoked = false;
						}
						break;
					}
					if (!workerSignal.aborted) throw error;
					await engine.cancel(
						coreId,
						"取消または期限のため終了",
						runtime,
						workerSignal,
					);
					break;
				}
				log({ kind: "step", ...step });
				const pending = step.pendingDecision;
				if (pending)
					await store.write((db) => {
						if (
							!db
								.query("SELECT 1 FROM example_jobs WHERE id=?")
								.get(pending.operationId)
						)
							put(db, pending.operationId, "decision", {}, null);
					});
				if (pause?.(step))
					return {
						view: (await engine.view(coreId))!,
						paused: true,
						markdown: null,
					};
				if (!step.done) launch(workerSignal);
			}
		} finally {
			workerSignal.removeEventListener("abort", woke);
		}
		const view = (await engine.view(coreId))!;
		let markdown: string | null = null;
		if (terminalStatuses.includes(view.status)) {
			steeringTarget?.close();
			const referencesCurrent = () =>
				store.readSnapshot((db) => {
					try {
						validateSteering(db, rowOf(db, run)!);
						return true;
					} catch (error) {
						if (!(error instanceof SteeringReferenceRevoked)) throw error;
						return false;
					}
				});
			if (
				referencesCurrent() &&
				view.report?.verificationIssue &&
				!workerSignal.aborted
			) {
				await engine.reverify(coreId, runtime, workerSignal);
			}
			await store.write((db) => {
				db.query("UPDATE pursuit_runs SET closed=1 WHERE id=?").run(run);
				db.query(
					"UPDATE example_jobs SET state='abandoned' WHERE state IN ('queued','running','ready')",
				).run();
			});
			const latest = store.readSnapshot((db) => stateOf(rowOf(db, run)!).draft);
			if (
				latest &&
				referencesCurrent() &&
				"title" in latest &&
				typeof latest.title === "string" &&
				!signal.aborted
			) {
				const began = performance.now();
				markdown = join(
					directory,
					(documentName(latest.title) || "report") + ".md",
				);
				await writeFile(markdown, new TextEncoder().encode(latest.answer));
				log({
					kind: "markdown_published",
					hash: hash(latest.answer),
					durationMs: performance.now() - began,
				});
			}
		}
		return { view: (await engine.view(coreId))!, paused: false, markdown };
	}
	return {
		steeringTarget: scope,
		drive,
		engine,
		coreId,
		runtime,
		jobs,
		snapshot: () =>
			store.readSnapshot((db) => ({
				state: stateOf(rowOf(db, run)!),
				documents: documents(db, rowOf(db, run)!),
			})),
		async close() {
			steeringTarget?.close();
			lifecycle.abort();
			await Promise.allSettled(active.values());
			reader.close();
			raw.close();
		},
	};
}

export function delay(ms: number, signal: AbortSignal) {
	return Bun.sleep(ms).then(() => signal.throwIfAborted());
}
