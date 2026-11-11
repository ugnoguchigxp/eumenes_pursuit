import {
	terminalStatuses,
	type JsonValue,
	type JsonObject,
	type LedgerDb,
	type StepResult,
	type ToolDescriptor,
	type LlmResult,
} from "../../contracts/index.ts";
import { budgetCounted } from "../generation/prompts.ts";
import { productiveRequest, decisionSchema } from "../generation/productive.ts";
import * as ledger from "../ledger/index.ts";
import {
	emptyProductiveState,
	type ProductiveState,
	type ProductiveChoice,
} from "../ledger/productivity.ts";
import type { PursuitView } from "../ledger/types.ts";
import {
	canonicalJson,
	digestJson,
	fingerprint,
} from "../rules/fingerprint.ts";
import { acceptancePassed } from "../rules/acceptance.ts";
import {
	attemptsOf,
	pursuitBudgetExceeded,
	remainingAttemptSlots,
} from "../rules/checks.ts";
import type { EngineCtx, EngineSteps } from "./context.ts";
import type { PursuitRuntime } from "./engine.ts";
import { normalPath, raceAcceptance } from "./helpers.ts";

const digest = (v: unknown) => digestJson(v as JsonValue);
const pendingOf = (v: PursuitView) =>
	v.attempts.filter((a) => a.state === "started" && a.pendingOperationId);
const facts = (v: PursuitView, excluded: readonly string[] = []) =>
	digest({
		attempts: v.attempts
			.filter((a) => a.state !== "started" && !excluded.includes(a.id))
			.map((a) => [a.id, a.state, a.observation, a.rejection]),
		answers: v.consultations.map((c) => [c.id, c.answer]),
		goal: v.goal,
		acceptance: v.acceptance,
	});

function savedArtifact(
	v: PursuitView,
	ws: string | null,
	tools: readonly ToolDescriptor[],
) {
	if (ws === null) return null;
	const latestFirst = [...v.attempts].reverse();
	const writer = latestFirst.find(
		(a) =>
			a.state !== "rejected" &&
			tools.some((t) => t.name === a.tool && t.sideEffect === "workspace"),
	);
	if (
		writer?.state !== "settled" ||
		writer.observation?.status !== "ok" ||
		writer.settlement?.digest !== ws
	)
		return null;
	const readBack = latestFirst.find(
		(a) =>
			a.seq > writer.seq &&
			a.state === "settled" &&
			a.observation?.status === "ok" &&
			a.settlement?.digest === ws &&
			tools.some(
				(t) => t.name === a.tool && t.readsBack && t.sideEffect === "none",
			),
	);
	return readBack ? { writer, readBack } : null;
}

function reusePartialArtifact(
	choice: ProductiveChoice,
	saved: ReturnType<typeof savedArtifact>,
	tools: readonly ToolDescriptor[],
) {
	const [write, readBack] = choice.actions;
	if (
		choice.choice !== "partial" ||
		!saved ||
		!write ||
		write.tool !== saved.writer.tool ||
		choice.actions.length > 2 ||
		(readBack && (!choice.sequence || readBack.tool !== saved.readBack.tool))
	)
		return undefined;
	const ignored = tools.find((t) => t.name === write.tool)?.reuseWriteIgnoring;
	if (!ignored) return undefined;
	const matches = (
		action: typeof write,
		prior: JsonObject,
		ignore: readonly string[],
	) => {
		if (action.text !== null || action.expectedStatus !== "ok") return false;
		try {
			const input: unknown = JSON.parse(action.inputJson);
			if (!input || typeof input !== "object" || Array.isArray(input))
				return false;
			const content = (value: object) =>
				canonicalJson(
					Object.fromEntries(
						Object.entries(value).filter(([key]) => !ignore.includes(key)),
					) as JsonObject,
				);
			return content(input) === content(prior);
		} catch {
			return false;
		}
	};
	if (
		matches(write, saved.writer.input, ignored) &&
		(!readBack || matches(readBack, saved.readBack.input, []))
	)
		return { write: saved.writer.seq, readBack: saved.readBack.seq };
	return undefined;
}

function exceedsHypothesisBudget(
	v: PursuitView,
	c: ProductiveChoice,
	tools: readonly ToolDescriptor[],
) {
	if (!v.input.conditions.rules) return false;
	const hypothesis = v.hypotheses.find((h) => h.id === v.currentHypothesisId);
	if (!hypothesis) return false;
	let remaining = c.renewHypothesis
		? v.input.policy.budget.attemptsPerHypothesis
		: hypothesis.budget -
			budgetCounted(v, attemptsOf(v, hypothesis.id), tools).length;
	for (const action of c.actions) {
		if (remaining <= 0) return true;
		if (
			v.input.conditions.attemptCount !== "mutating" ||
			tools.some((t) => t.name === action.tool && t.sideEffect === "workspace")
		)
			remaining--;
	}
	return false;
}

function verificationKey(
	v: PursuitView,
	ws: string | null,
	tools: readonly ToolDescriptor[],
) {
	const nonEvidence = new Set(
		tools
			.filter(
				(t) =>
					!t.acceptanceEvidence &&
					(t.sideEffect === "workspace" || t.readsBack || t.readsWorkspace),
			)
			.map((t) => t.name),
	);
	const receipts = new Set(
		v.attempts
			.filter(
				(a) =>
					a.state === "settled" &&
					a.observation?.status === "ok" &&
					!nonEvidence.has(a.tool),
			)
			.map((a) => digest([a.tool, a.observation, a.refs])),
	);
	return digest({
		workspace: ws,
		receipts: [...receipts].sort(),
		answers: v.consultations.map((c) => [c.id, c.answer]),
	});
}

function parked(
	v: PursuitView,
	p: NonNullable<ProductiveState["plan"]>,
	ws: string | null,
	tools: readonly ToolDescriptor[],
) {
	if (
		!p.waitAfterDispatch ||
		p.finish ||
		p.actions.length ||
		!p.owned.some((id) => pendingOf(v).some((a) => a.id === id))
	)
		return false;
	const ownWriter = v.attempts.find(
		(a) =>
			p.owned.includes(a.id) &&
			a.observation?.status === "ok" &&
			tools.some((t) => t.name === a.tool && t.sideEffect === "workspace"),
	);
	return (
		p.facts === facts(v, p.owned) &&
		(ownWriter?.settlement?.digest ?? p.digest) === ws &&
		p.toolsDigest === digest(tools)
	);
}
function locked(
	v: PursuitView,
	tool: ToolDescriptor | undefined,
	tools: readonly ToolDescriptor[],
) {
	return (
		pendingOf(v).some(
			(a) => tools.find((t) => t.name === a.tool)?.sideEffect === "workspace",
		) &&
		!!tool &&
		(tool.sideEffect === "workspace" ||
			!!tool.readsWorkspace ||
			!!tool.readsBack)
	);
}
export function makeProductive(
	ctx: EngineCtx,
): Pick<EngineSteps, "productive" | "productiveResult"> {
	const { store, read, clock, ids, result, inference, llmRow, checkTime } = ctx;
	const basis = (
		v: PursuitView,
		ws: string | null,
		tools: readonly ToolDescriptor[],
		s: ProductiveState,
	) =>
		digest({
			facts: facts(v),
			pending: pendingOf(v).map((a) => [a.id, a.tool]),
			workspace: ws,
			tools,
			thought: s.thought,
			verifications: v.verifications,
		});
	async function save(v: PursuitView, s: ProductiveState) {
		await store.write((db) => {
			ledger.setProductiveState(db, v.id, s);
			ledger.advancePursuit(db, {
				id: v.id,
				expectedRevision: v.revision,
				now: clock.now(),
			});
		});
		return read(v.id);
	}
	async function productiveResult(
		r: StepResult,
		runtime: PursuitRuntime,
	): Promise<StepResult> {
		const v = await read(r.pursuitId),
			s = v.productive ?? emptyProductiveState();
		if (terminalStatuses.includes(v.status))
			return { ...r, workReady: false, pendingTools: [] };
		const tools = runtime.tools.list(),
			ws = runtime.workspace ? await runtime.workspace.digest() : null;
		let ready =
			!terminalStatuses.includes(v.status) &&
			v.status !== "awaiting_consultation";
		if (s.request) ready = false;
		else if (ready && s.plan) {
			if (parked(v, s.plan, ws, tools)) ready = false;
			else {
				const a = s.plan.awaiting
					? v.attempts.find((a) => a.id === s.plan!.awaiting)
					: null;
				ready =
					a?.state !== "started" &&
					!locked(
						v,
						tools.find((t) => t.name === s.plan!.actions[0]?.tool),
						tools,
					);
				if (
					s.plan.finish &&
					!s.plan.actions.length &&
					pendingOf(v).length &&
					(!s.plan.cancelPending ||
						pendingOf(v).some(
							(a) =>
								tools.find((t) => t.name === a.tool)?.sideEffect ===
								"workspace",
						))
				)
					ready = false;
			}
		} else if (ready && s.waitBasis === basis(v, ws, tools, s)) ready = false;
		const pendingTools = pendingOf(v).map((a) => ({
			attemptId: a.id,
			operationId: a.pendingOperationId!,
		}));
		return {
			...r,
			workReady: ready,
			pendingTools,
			...(s.request ? { pendingDecision: { operationId: s.request.id } } : {}),
			...(pendingTools[0] ? { pendingTool: pendingTools[0] } : {}),
		};
	}
	async function productive(
		view: PursuitView,
		runtime: PursuitRuntime,
		signal: AbortSignal,
		resolved?: { operationId: string; response: LlmResult<unknown> },
	): Promise<StepResult> {
		let v = view,
			s = v.productive ?? emptyProductiveState();
		const wrap = (r: StepResult) => productiveResult(r, runtime);
		checkTime(v, signal);
		const unknown = v.attempts.find(
			(a) => a.state === "started" && !a.pendingOperationId,
		);
		if (unknown) {
			await store.write((db) => {
				ledger.interruptAttempt(db, { id: unknown.id, now: clock.now() });
				ledger.clearProductivePlan(db, v.id);
				ledger.advancePursuit(db, {
					id: v.id,
					expectedRevision: v.revision,
					now: clock.now(),
				});
			});
			return wrap(result(v, v.revision + 1, v.status, "interrupted"));
		}
		const unsettled = v.attempts.find(
			(a) =>
				a.state === "settled" && a.settlement && a.settlement.stage !== "done",
		);
		if (unsettled)
			return wrap(await ctx.resumeSettlement(v, runtime, unsettled.id, signal));
		const budgetStop = pursuitBudgetExceeded(v, clock.now());
		const stopAtBudget = async () =>
			wrap(
				await ctx.finish(
					v,
					runtime,
					"stopped",
					"追求の上限に達しました",
					"rules",
					signal,
				),
			);
		// The attempt cap prevents new tools. A fully dispatched terminal plan may
		// still settle and verify, subject to the time and transition limits.
		if (
			budgetStop &&
			!(
				budgetStop === "attempts" &&
				v.revision < v.input.policy.budget.transitions &&
				s.plan?.finish &&
				!s.plan.actions.length
			)
		)
			return stopAtBudget();
		if (v.status === "planning")
			return wrap(await ctx.plan(v, runtime, signal));
		if (v.status === "hypothesizing")
			return wrap(await ctx.hypothesize(v, runtime, signal));
		if (v.status === "reviewing")
			return wrap(await ctx.review(v, runtime, signal));
		const tools = runtime.tools.list(),
			ws = runtime.workspace ? await runtime.workspace.digest() : null;
		let b = basis(v, ws, tools, s);
		if (s.request && !resolved)
			return wrap(result(v, v.revision, v.status, "waiting_tool"));
		if (s.plan) {
			let p = s.plan;
			if (parked(v, p, ws, tools))
				return wrap(result(v, v.revision, v.status, "waiting_tool"));
			const awaited = p.awaiting
				? v.attempts.find((a) => a.id === p.awaiting)
				: undefined;
			if (awaited?.state === "started")
				return wrap(result(v, v.revision, v.status, "waiting_tool"));
			const failed = p.owned.some((id) => {
				const a = v.attempts.find((a) => a.id === id);
				return (
					a?.state === "rejected" ||
					a?.state === "interrupted" ||
					a?.observation?.status === "error"
				);
			});
			if (
				awaited?.state === "settled" &&
				awaited.observation?.status === "ok"
			) {
				const writer =
					tools.find((t) => t.name === awaited.tool)?.sideEffect ===
					"workspace";
				p = {
					...p,
					awaiting: null,
					...(writer ? { digest: awaited.settlement?.digest ?? ws } : {}),
				};
				s = { ...s, plan: p };
			}
			const sensitive = p.actions.some((a) => {
				const t = tools.find((t) => t.name === a.tool);
				return (
					t?.sideEffect === "workspace" || t?.readsWorkspace || t?.readsBack
				);
			});
			if (
				failed ||
				p.toolsDigest !== digest(tools) ||
				p.facts !== facts(v, p.owned) ||
				((sensitive || p.finish) && p.digest !== ws)
			) {
				s = { ...s, plan: null, waitBasis: null };
				v = await save(v, s);
				if (budgetStop) return stopAtBudget();
				b = basis(v, ws, tools, s);
			} else if (p.actions.length) {
				const a = p.actions[0]!;
				if (
					locked(
						v,
						tools.find((t) => t.name === a.tool),
						tools,
					)
				)
					return wrap(result(v, v.revision, v.status, "waiting_tool"));
				const r = await ctx.attempt(
					v,
					runtime,
					{ kind: "tool", ...a, following: [], message: p.reason, missing: "" },
					null,
					tools,
					signal,
					(db, id) => {
						const next = {
							...p,
							actions: p.actions.slice(1),
							owned: [...p.owned, id],
							awaiting:
								p.sequence || (p.waitForCheckpoint && !p.owned.length)
									? id
									: null,
						};
						ledger.setProductiveState(db, v.id, {
							...s,
							plan:
								next.actions.length ||
								next.finish ||
								next.awaiting ||
								next.waitAfterDispatch
									? next
									: null,
							waitBasis: null,
						});
					},
				);
				return wrap(r);
			} else if (p.finish) {
				if (
					pendingOf(v).length &&
					(!p.cancelPending ||
						pendingOf(v).some(
							(a) =>
								tools.find((t) => t.name === a.tool)?.sideEffect ===
								"workspace",
						))
				)
					return wrap(result(v, v.revision, v.status, "waiting_tool"));
				const verificationBasis = verificationKey(v, ws, tools);
				let verdict = s.verification;
				if (verdict?.basis !== verificationBasis) {
					checkTime(v, signal);
					const { criteria, issue } = await raceAcceptance(signal, () =>
						runtime.acceptance.verify(signal),
					);
					checkTime(v, signal);
					if (issue)
						return wrap(
							await ctx.finish(
								v,
								runtime,
								"incomplete",
								"独立した最終検証の結果を受領できませんでした",
								"rules",
								signal,
								{ issue, criteria },
							),
						);
					verdict = {
						basis: verificationBasis,
						criteria,
						passed: acceptancePassed(v.acceptance, criteria),
					};
					await store.write((db) => {
						ledger.insertVerification(db, {
							id: ids.next("ver"),
							pursuitId: v.id,
							row: {
								attemptId: null,
								trigger: "claim",
								passed: verdict!.passed,
								criteria,
							},
							now: clock.now(),
						});
						ledger.setProductiveState(db, v.id, {
							...s,
							verification: verdict,
							plan:
								p.finish === "completed" && !verdict!.passed && !budgetStop
									? null
									: p,
						});
						ledger.advancePursuit(db, {
							id: v.id,
							expectedRevision: v.revision,
							now: clock.now(),
						});
					});
					v = await read(v.id);
					s = v.productive!;
				}
				const refused = p.finish === "completed" && !verdict!.passed;
				if (refused && !budgetStop) {
					if (s.verification?.basis === verificationBasis && s.plan) {
						v = await save(v, { ...s, plan: null });
					}
					return wrap(result(v, v.revision, v.status, "rejected"));
				}
				return wrap(
					await ctx.finish(
						v,
						runtime,
						refused ? "incomplete" : p.finish,
						refused
							? "独立した最終検証が不合格で、試行の上限に達しました"
							: p.reason,
						refused ? "rules" : "review",
						signal,
						verdict!.criteria,
					),
				);
			} else {
				s = { ...s, plan: null };
				v = await save(v, s);
				b = basis(v, ws, tools, s);
			}
		}
		if (!resolved) {
			if (s.waitBasis === b)
				return wrap(result(v, v.revision, v.status, "waiting_tool"));
			const request = productiveRequest(
					v,
					tools,
					b,
					savedArtifact(v, ws, tools)?.readBack.seq ?? null,
				),
				id = ids.next("decision");
			v = await save(v, {
				...s,
				request: {
					id,
					basis: b,
					workspace: ws,
					assessed: v.attempts
						.filter((a) => a.state !== "started" && !s.assessed.includes(a.seq))
						.map((a) => a.seq),
					system: request.system,
					prompt: request.prompt,
					maxOutputTokens: request.maxOutputTokens,
				},
			});
			return wrap(result(v, v.revision, v.status, "waiting_tool"));
		}
		if (!s.request || s.request.id !== resolved.operationId)
			throw new Error("decision_result_not_pending");
		const captured = s.request;
		const requested = captured.assessed;
		const parsed = decisionSchema(v).safeParse(resolved.response.value);
		if (!parsed.success) {
			await store.write((db) => {
				inference(db, v, [llmRow("propose", resolved.response)]);
				ledger.claimOperation(db, {
					key: `controller-result:${resolved.operationId}`,
					kind: "controller_result",
					digest: digest(resolved.response),
					pursuitId: v.id,
					now: clock.now(),
				});
				ledger.setProductiveState(db, v.id, { ...s, request: null });
				ledger.advancePursuit(db, {
					id: v.id,
					expectedRevision: v.revision,
					now: clock.now(),
				});
			});
			return wrap(
				await ctx.finish(
					await read(v.id),
					runtime,
					"incomplete",
					"進捗制御の応答形式を検証できませんでした",
					"rules",
					signal,
				),
			);
		}
		const r = { ...resolved.response, value: parsed.data };
		const c: ProductiveChoice = r.value;
		b = captured.basis;
		if (b !== basis(v, ws, tools, s) && c.choice !== "think") {
			await store.write((db) => {
				inference(db, v, [llmRow("propose", r)]);
				ledger.claimOperation(db, {
					key: `controller-result:${resolved.operationId}`,
					kind: "controller_result",
					digest: digest(resolved.response),
					pursuitId: v.id,
					now: clock.now(),
				});
				ledger.insertProgress(db, v.id, {
					id: ids.next("progress"),
					basis: b,
					verdict: c.progress,
					choice: c,
					model: r.model,
					at: clock.now(),
					assurance: "model",
					status: "superseded",
				});
				ledger.setProductiveState(db, v.id, {
					...s,
					request: null,
					waitBasis: null,
				});
				ledger.advancePursuit(db, {
					id: v.id,
					expectedRevision: v.revision,
					now: clock.now(),
				});
			});
			return wrap(result(v, v.revision + 1, v.status, "interrupted"));
		}
		const errors: string[] = [];
		const finalizing = c.choice === "complete" || c.choice === "partial";
		const reusedArtifact = reusePartialArtifact(
			c,
			savedArtifact(v, ws, tools),
			tools,
		);
		const sameSet = (a: readonly number[], d: readonly number[]) =>
			a.length === new Set(a).size &&
			a.length === d.length &&
			a.every((x) => d.includes(x));
		if (c.basis !== b || !sameSet(c.progress.assessed, requested))
			errors.push("assessment_basis");
		if (
			c.progress.criteria.some(
				(id) => !v.acceptance.some((a) => a.id === id),
			) ||
			c.progress.evidence.some(
				(n) =>
					!v.attempts.some(
						(a) =>
							a.seq === n &&
							(a.state === "settled" ||
								(c.progress.kind === "constraint" &&
									(a.state === "rejected" || a.state === "interrupted"))),
					),
			)
		)
			errors.push("evidence_reference");
		if (
			!["initial", "none", "blocked"].includes(c.progress.kind) &&
			(!c.progress.change.trim() ||
				(c.progress.kind !== "constraint" && !c.progress.criteria.length))
		)
			errors.push("missing_semantic_delta");
		if (
			c.choice === "think" &&
			(c.progress.kind !== "reasoning" ||
				!c.progress.conclusions.some((t) => t.trim()) ||
				(v.progress ?? []).some(
					(p) =>
						digest(p.verdict.conclusions) === digest(c.progress.conclusions),
				))
		)
			errors.push("empty_thinking_checkpoint");
		if (
			c.progress.kind === "artifact" &&
			(ws === s.workspaceAtAssessment ||
				!requested.some((n) => {
					const a = v.attempts.find((a) => a.seq === n);
					return (
						a?.observation?.status === "ok" &&
						tools.some((t) => t.name === a.tool && t.sideEffect === "workspace")
					);
				}))
		)
			errors.push("artifact_not_changed");
		if (
			c.progress.kind === "initial" &&
			(v.progress ?? []).some((p) => p.status !== "superseded")
		)
			errors.push("initial_after_start");
		if (
			c.choice === "act" &&
			(!c.actions.length ||
				!c.contribution.trim() ||
				(["none", "blocked"].includes(c.progress.kind) &&
					c.route === "advance"))
		)
			errors.push("no_executable_advance");
		if (
			c.choice === "act" &&
			["none", "blocked"].includes(c.progress.kind) &&
			c.actions.some((a) => {
				const t = tools.find((t) => t.name === a.tool);
				if (!t) return false;
				try {
					const input = JSON.parse(a.inputJson);
					if (!input || Array.isArray(input) || typeof input !== "object")
						return false;
					if (t.textField && a.text !== null) input[t.textField] = a.text;
					const fp = fingerprint(t, input, ws);
					return v.attempts.some((old) => old.fingerprint === fp);
				} catch {
					return false;
				}
			})
		)
			errors.push("unchanged_operation");
		if (c.choice === "wait" && (!pendingOf(v).length || c.actions.length))
			errors.push("wait_without_dependency");
		if (c.choice === "consult" && !c.missing.trim())
			errors.push("consult_without_prerequisite");
		if ((c.choice === "think" || c.choice === "consult") && c.actions.length)
			errors.push("unexpected_actions");
		if (
			c.actions.some(
				(a) =>
					!tools.some(
						(t) => t.name === a.tool && v.input.grant.includes(t.permission),
					),
			)
		)
			errors.push("tool_permission");
		if (c.choice === "act" && c.actions.length > 1 && !c.sequence) {
			const descriptors = c.actions.map((a) =>
				tools.find((t) => t.name === a.tool),
			);
			if (
				descriptors.filter((t) => t?.sideEffect === "workspace").length > 1 ||
				descriptors.some(
					(t) =>
						!t ||
						t.readsWorkspace ||
						t.readsBack ||
						!["none", "workspace"].includes(t.sideEffect),
				)
			)
				errors.push("dependent_actions");
		}

		if (finalizing && c.actions.length > 1 && !c.sequence)
			errors.push("finalization_sequence");
		if (!reusedArtifact && c.actions.length) {
			if (c.actions.length > remainingAttemptSlots(v))
				errors.push("plan_budget");
			if (exceedsHypothesisBudget(v, c, tools))
				errors.push("plan_hypothesis_budget");
		}
		if (
			c.actions.some(
				(a) => tools.find((t) => t.name === a.tool)?.sideEffect === "workspace",
			) &&
			!runtime.workspace
		)
			errors.push("workspace_required");
		if (
			c.choice === "complete" &&
			s.verification?.basis === verificationKey(v, ws, tools) &&
			!s.verification.passed &&
			c.actions.every((a) => {
				const t = tools.find((t) => t.name === a.tool);
				if (!t?.acceptanceEvidence && (t?.readsBack || t?.readsWorkspace))
					return true;
				try {
					return v.attempts.some(
						(old) =>
							old.tool === a.tool &&
							old.observation?.status === "ok" &&
							digest(old.input) === digest(JSON.parse(a.inputJson)) &&
							a.text === null,
					);
				} catch {
					return false;
				}
			})
		)
			errors.push("unchanged_failed_claim");
		if (
			!reusedArtifact &&
			(c.renewStrategy || c.renewHypothesis) &&
			pendingOf(v).some(
				(a) => tools.find((t) => t.name === a.tool)?.sideEffect === "workspace",
			)
		)
			errors.push("scope_change_during_write");
		if (
			!reusedArtifact &&
			(c.renewStrategy || c.renewHypothesis) &&
			!c.actions.length
		)
			errors.push("scope_without_action");
		if (!reusedArtifact && c.renewStrategy && !c.renewHypothesis)
			errors.push("strategy_without_hypothesis");
		if (
			!reusedArtifact &&
			c.renewStrategy &&
			v.strategies.length >= v.input.policy.budget.strategies
		)
			errors.push("strategy_budget");
		if (
			!reusedArtifact &&
			c.renewHypothesis &&
			!c.renewStrategy &&
			v.hypotheses.filter((h) => h.strategyId === v.currentStrategyId).length >=
				v.input.policy.budget.hypothesesPerStrategy
		)
			errors.push("hypothesis_budget");
		const priorAction = (v.progress ?? [])
			.filter((p) => p.status !== "superseded")
			.reverse()
			.find(
				(p) =>
					p.choice.choice === "act" ||
					!["none", "blocked"].includes(p.verdict.kind),
			);
		if (
			c.choice === "act" &&
			["none", "blocked"].includes(c.progress.kind) &&
			priorAction?.choice.choice === "act" &&
			["none", "blocked"].includes(priorAction.verdict.kind)
		)
			errors.push("alternative_without_progress");
		if (errors.length) {
			const alreadyRepaired = s.repair?.basis === b;
			await store.write((db) => {
				inference(db, v, [llmRow("propose", r)]);
				ledger.claimOperation(db, {
					key: `controller-result:${resolved.operationId}`,
					kind: "controller_result",
					digest: digest(resolved.response),
					pursuitId: v.id,
					now: clock.now(),
				});
				ledger.insertDecision(db, {
					id: ids.next("dec"),
					pursuitId: v.id,
					kind: "continue",
					reason: "進捗制御の契約に適合しない応答を実行しなかった",
					basis: { rules: errors },
					decidedBy: "rules",
					now: clock.now(),
				});
				ledger.setProductiveState(db, v.id, {
					...s,
					request: null,
					plan: null,
					waitBasis: null,
					repair: { basis: b, issues: errors },
				});
				ledger.advancePursuit(db, {
					id: v.id,
					expectedRevision: v.revision,
					now: clock.now(),
				});
			});
			const latest = await read(v.id);
			if (!alreadyRepaired)
				return wrap(result(latest, latest.revision, latest.status, "rejected"));
			return wrap(
				await ctx.finish(
					latest,
					runtime,
					"incomplete",
					`進捗判断を採用できませんでした: ${errors.join(", ")}`,
					"rules",
					signal,
					s.verification?.basis === verificationKey(v, ws, tools)
						? s.verification.criteria
						: undefined,
				),
			);
		}

		// The host checkpoint may be prepared outside the writer; ledger effects
		// and the controller receipt must commit together.
		const renewal =
			!reusedArtifact && c.renewHypothesis
				? {
						strategyId: c.renewStrategy
							? ids.next("str")
							: v.currentStrategyId!,
						hypothesisId: ids.next("hyp"),
						checkpoint: runtime.workspace
							? await runtime.workspace.checkpoint()
							: null,
					}
				: null;
		checkTime(v, signal);

		const waitForCheckpoint =
			renewal &&
			c.renewStrategy &&
			c.choice === "act" &&
			tools.some(
				(tool) =>
					tool.name === c.actions[0]?.tool && tool.sideEffect === "workspace",
			);
		const recordId = ids.next("progress");
		const next: ProductiveState = {
			...s,
			request: null,
			assessed: [...new Set([...s.assessed, ...requested])],
			thought: s.thought + (c.choice === "think" ? 1 : 0),
			notes: [...s.notes, ...c.progress.conclusions].slice(-20),
			workspaceAtAssessment: captured.workspace,
			waitBasis: c.choice === "wait" ? b : null,
			plan:
				c.actions.length || c.choice === "complete" || c.choice === "partial"
					? {
							actions: reusedArtifact ? [] : c.actions,
							sequence: finalizing || c.sequence,
							...(waitForCheckpoint
								? { waitForCheckpoint: true as const }
								: {}),
							finish:
								c.choice === "complete"
									? "completed"
									: c.choice === "partial"
										? "incomplete"
										: null,
							reason: c.reason,
							cancelPending: c.cancelPending,
							waitAfterDispatch:
								c.choice === "act" && !c.sequence && c.waitAfterDispatch,
							digest: ws,
							toolsDigest: digest(tools),
							facts: facts(v),
							owned: [],
							awaiting: null,
						}
					: null,
		};
		const record = (db: LedgerDb) => {
			inference(db, v, [llmRow("propose", r)]);
			ledger.claimOperation(db, {
				key: `controller-result:${resolved.operationId}`,
				kind: "controller_result",
				digest: digest(resolved.response),
				pursuitId: v.id,
				now: clock.now(),
			});
			if (renewal && c.renewHypothesis) {
				const active = v.hypotheses.find((h) => h.id === v.currentHypothesisId);
				if (active?.status === "active")
					ledger.closeHypothesis(db, {
						id: active.id,
						result: c.reason,
						now: clock.now(),
					});
				if (c.renewStrategy) {
					const previous = v.strategies.find(
						(strategy) => strategy.id === v.currentStrategyId,
					);
					if (previous?.status === "active")
						ledger.closeStrategy(db, {
							id: previous.id,
							reason: c.reason,
							now: clock.now(),
						});
					ledger.insertStrategy(db, {
						id: renewal.strategyId,
						pursuitId: v.id,
						body: c.renewStrategy.body,
						rationale: c.renewStrategy.rationale,
						alternatives: c.renewStrategy.alternatives,
						parts: c.renewStrategy.parts,
						previousId: v.currentStrategyId,
						now: clock.now(),
					});
				}
				ledger.insertHypothesis(db, {
					id: renewal.hypothesisId,
					pursuitId: v.id,
					strategyId: renewal.strategyId,
					body: c.renewHypothesis.body,
					rationale: c.reason,
					tools: c.actions.map((a) => a.tool),
					targets: c.renewHypothesis.targets.map(normalPath).filter(Boolean),
					expected: c.renewHypothesis.expected,
					budget: v.input.conditions.rules
						? v.input.policy.budget.attemptsPerHypothesis
						: v.input.policy.budget.attempts,
					checkpoint: renewal.checkpoint,
					now: clock.now(),
				});
			}

			ledger.insertProgress(db, v.id, {
				id: recordId,
				basis: b,
				verdict: c.progress,
				choice: c,
				model: r.model,
				at: clock.now(),
				assurance: "model",
				status: "accepted",
				...(reusedArtifact ? { reusedArtifact } : {}),
			});
			ledger.setProductiveState(db, v.id, next);
		};
		if (c.choice === "consult")
			return wrap(await ctx.consult(v, c.reason, c.missing, "review", record));
		await store.write((db) => {
			record(db);
			ledger.advancePursuit(db, {
				id: v.id,
				expectedRevision: v.revision,
				now: clock.now(),
				...(renewal
					? {
							currentStrategyId: renewal.strategyId,
							currentHypothesisId: renewal.hypothesisId,
						}
					: {}),
			});
		});
		v = await read(v.id);
		return wrap(
			result(
				v,
				v.revision,
				v.status,
				c.choice === "wait" ? "waiting_tool" : "planned",
			),
		);
	}
	return { productive, productiveResult };
}
