import {
	terminalStatuses,
	type CriterionResult,
	type DecidedBy,
	type JsonObject,
	type LedgerDb,
	type LlmPort,
	type LlmRequest,
	type LlmResult,
	type PursuitStatus,
	type StepEvent,
	type StepResult,
	type ToolDescriptor,
} from "../../contracts/index.ts";
import type { Report } from "../../contracts/index.ts";
import type { Proposal } from "../generation/prompts.ts";
import * as ledger from "../ledger/index.ts";
import type { InferenceRow, PursuitView } from "../ledger/types.ts";
import { remainingWallMs } from "../rules/checks.ts";
import { WallTimeExpired } from "./helpers.ts";
import type { EngineDeps, PursuitRuntime } from "./engine.ts";

export function makeBase(deps: EngineDeps) {
	const { store, clock, ids } = deps;
	const warn = (code: string, detail: JsonObject) =>
		deps.onWarning?.(code, detail);

	async function read(id: string): Promise<PursuitView> {
		const view = await store.readSnapshot((db) => ledger.loadPursuit(db, id));
		if (!view) throw new Error(`pursuit_not_found:${id}`);
		return view;
	}

	function result(
		view: PursuitView,
		revision: number,
		status: PursuitStatus,
		event: StepEvent,
	): StepResult {
		return {
			pursuitId: view.id,
			status,
			revision,
			event,
			done: terminalStatuses.includes(status),
		};
	}

	function inference(
		db: LedgerDb,
		view: PursuitView,
		rows: readonly InferenceRow[],
	) {
		for (const row of rows)
			ledger.insertInference(db, {
				id: ids.next("inf"),
				pursuitId: view.id,
				row,
				now: clock.now(),
			});
	}

	const llmRow = <T>(purpose: string, r: LlmResult<T>): InferenceRow => ({
		purpose,
		model: r.model,
		inputTokens: r.inputTokens,
		outputTokens: r.outputTokens,
		cacheReadTokens: r.cacheReadTokens,
		latencyMs: r.latencyMs,
	});

	async function call<T>(
		port: LlmPort,
		request: LlmRequest<T>,
		signal: AbortSignal,
		view: PursuitView,
	): Promise<LlmResult<T>> {
		checkTime(view, signal);
		const r = await port.complete(request, signal);
		checkTime(view, signal);
		return r;
	}
	function checkTime(view: PursuitView, signal: AbortSignal) {
		if (remainingWallMs(view, clock.now()) <= 0) throw new WallTimeExpired();
		signal.throwIfAborted();
	}
	return {
		deps,
		store,
		clock,
		ids,
		warn,
		read,
		result,
		inference,
		llmRow,
		call,
		checkTime,
	};
}
export type EngineBase = ReturnType<typeof makeBase>;
export type EngineHelpers = EngineBase;

/** 段の関数。互いに呼び合うので、型を明示する（推論させると循環して tsc が失敗する）。引数は engine.ts の宣言をそのまま写す。 */
export interface EngineSteps {
	finish(
		view: PursuitView,
		runtime: PursuitRuntime,
		outcome: Report["outcome"],
		reason: string,
		decidedBy: DecidedBy,
		signal: AbortSignal,
		known?: readonly CriterionResult[],
		basisExtra?: JsonObject,
	): Promise<StepResult>;
	stepBack(
		view: PursuitView,
		reason: string,
		decidedBy: DecidedBy,
		basis: JsonObject,
	): Promise<StepResult>;
	consult(
		view: PursuitView,
		question: string,
		missing: string,
		decidedBy: DecidedBy,
		extra?: (db: LedgerDb) => void,
		basisExtra?: JsonObject,
	): Promise<StepResult>;
	plan(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	hypothesize(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	propose(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
	attempt(
		view: PursuitView,
		runtime: PursuitRuntime,
		p: Proposal,
		usage: InferenceRow,
		tools: readonly ToolDescriptor[],
		signal: AbortSignal,
	): Promise<StepResult>;
	resumeSettlement(
		view: PursuitView,
		runtime: PursuitRuntime,
		attemptId: string,
		signal: AbortSignal,
	): Promise<StepResult>;
	review(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
	): Promise<StepResult>;
}
export type EngineCtx = EngineHelpers & EngineSteps;
