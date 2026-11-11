import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { createSteeringInbox } from "eumenes-steer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	openExample,
	delay,
	type HostOptions,
} from "../../examples/eumenes/host.ts";
import {
	fixture,
	scripted,
	type Case,
} from "../../examples/eumenes/fixtures.ts";
import provenance from "../../examples/eumenes/provenance.json";
import {
	prepareSteering,
	type SteeringReference,
} from "../../examples/eumenes/steering.ts";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
async function config(name: Case, extra: Partial<HostOptions> = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pursuit-eumenes-"));
	dirs.push(dir);
	const events: Record<string, unknown>[] = [];
	const f = fixture(name, { lookup: 15, read: 25, stagger: 40 });
	return {
		events,
		f,
		options: {
			directory: dir,
			execution: "productive",
			generator: scripted(name),
			request: f.request,
			web: f.web,
			limits: f.limits,
			log: (e) => events.push(e),
			...extra,
		} satisfies HostOptions,
	};
}

test("upstream snapshots retain provenance and the copied tool bodies match", async () => {
	for (const name of ["tools.ts", "acceptance.ts"] as const) {
		const path = new URL(`../../examples/eumenes/${name}`, import.meta.url);
		const original = await Bun.file(
			new URL(`source-snapshot/${name}.txt`, path),
		).text();
		expect(new Bun.CryptoHasher("sha256").update(original).digest("hex")).toBe(
			provenance.sources[name].sha256,
		);
		if (name === "tools.ts") {
			const copied = await Bun.file(path).text();
			const marker = "const inputs";
			expect(copied.slice(copied.indexOf(marker)).replace(/\s/g, "")).toBe(
				original.slice(original.indexOf(marker)).replace(/\s/g, ""),
			);
		}
	}
});

test("independent thought and parallel fetch overlap; unchanged wait has no model calls; real Markdown readback and grade", async () => {
	const { events, options } = await config("museum", {
		generator: scripted("museum", { think: true }),
		markdownDelayMs: 12,
	});
	const host = await openExample(options);
	try {
		const { view, markdown } = await host.drive();
		expect(view.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(await readFile(markdown!, "utf8")).toBe(
			host.snapshot().state.draft!.answer,
		);
		expect(host.snapshot().documents.map((d) => d.url)).toEqual([
			"https://fixture.example/b",
			"https://fixture.example/a",
		]);
		expect(view.attempts.map((a) => a.tool)).toEqual([
			"web_read",
			"web_read",
			"report_draft",
			"report_read",
		]);
		expect(
			view.progress?.some(
				(p) => p.verdict.kind === "reasoning" && p.status === "accepted",
			),
		).toBe(true);
		const readStart = events.findIndex(
			(e) => e.kind === "job_started" && e.job === "read",
		);
		const ready = events.findIndex(
			(e) => e.kind === "job_ready" && e.job === "read",
		);
		expect(
			events
				.slice(readStart, ready)
				.filter((e) => e.kind === "job_started" && e.job === "read"),
		).toHaveLength(2);
		expect(
			events
				.slice(readStart, ready)
				.some((e) => e.kind === "model_finished" && e.purpose === "propose"),
		).toBe(true);
		expect(
			events.filter(
				(e) => e.kind === "model_finished" && e.purpose === "grade",
			),
		).toHaveLength(1);
		const readback = view.attempts.at(-1)?.observation?.output as {
			report: { answer: string };
		};
		expect(readback.report.answer).toBe(host.snapshot().state.draft!.answer);
	} finally {
		await host.close();
	}
});

test.each(["missing", "cap"] as const)(
	"partial retains acquired evidence after %s",
	async (name) => {
		const { options } = await config(name);
		const host = await openExample(options);
		try {
			const { view, markdown } = await host.drive();
			expect(view.status).toBe("incomplete");
			expect(view.report?.verified).toBe(false);
			expect(host.snapshot().documents).toHaveLength(1);
			expect(host.snapshot().state.draft?.completion).toBe("incomplete");
			expect(host.snapshot().state.draft?.claims[0]?.evidence).toEqual(["e1"]);
			expect(await readFile(markdown!, "utf8")).toContain("禁止表示");
		} finally {
			await host.close();
		}
	},
);

test.each([false, true])(
	"one remaining slot saves the partial report and grades it once (overlong plan=%s)",
	async (overlong) => {
		const { options, events } = await config("cap");
		const base = options.generator;
		const host = await openExample({
			...options,
			generator: {
				async complete(request, signal) {
					const response = await base.complete(request, signal);
					if (request.purpose !== "propose") return response;
					const value = response.value as {
						choice: string;
						progress: { kind: string };
						actions: { inputJson: string }[];
					};
					if (value.progress.kind === "initial") {
						const [read] = value.actions;
						const save = {
							...read,
							tool: "report_draft",
							inputJson: JSON.stringify({
								title: "資料比較",
								completion: "incomplete",
								answer: "施設Aと施設Bの本文は未確認",
								summary: "本文取得待ち",
								claims: [],
								limitations: ["本文未確認"],
								stopReason: "本文取得前の下書き",
							}),
						};
						return {
							...response,
							value: request.schema.parse({
								...value,
								actions: [save, read],
								waitAfterDispatch: true,
							}),
						};
					}
					if (value.choice !== "partial") return response;
					const packet = JSON.parse(request.prompt);
					const state = JSON.parse(packet.state.split("\n\n").at(-1));
					expect(state.remainingAttemptSlots).toBe(1);
					if (overlong && !state.choiceViolations.length) return response;
					if (overlong) {
						expect(state.choiceViolations).toEqual(["plan_budget"]);
						expect(state.attempts.map((a: { tool: string }) => a.tool)).toEqual(
							["report_draft", "web_read"],
						);
					}
					return {
						...response,
						value: request.schema.parse({
							...value,
							actions: value.actions.slice(0, 1),
							sequence: false,
						}),
					};
				},
			},
		});
		try {
			const { view, markdown } = await host.drive();
			expect(view.status).toBe("incomplete");
			expect(view.report?.criteria.map((c) => c.passed)).toEqual([true, false]);
			expect(view.attempts.map((a) => [a.tool, a.state])).toEqual([
				["report_draft", "settled"],
				["web_read", "settled"],
				["report_draft", "settled"],
			]);
			expect(view.progress?.at(-1)?.choice.sequence).toBe(false);
			expect(host.snapshot().state.draft?.claims[0]?.evidence).toEqual(["e1"]);
			expect(await readFile(markdown!, "utf8")).toContain("禁止表示");
			const purposes = events
				.filter((e) => e.kind === "model_finished")
				.map((e) => e.purpose);
			expect(purposes).toEqual([
				"plan",
				"hypothesize",
				"propose",
				"propose",
				...(overlong ? ["propose"] : []),
				"grade",
			]);
		} finally {
			await host.close();
		}
	},
);

test("a completed plan can pass acceptance at the attempt cap", async () => {
	const { options, events } = await config("museum");
	const base = options.generator;
	const host = await openExample({
		...options,
		limits: { ...options.limits, childCalls: 2 },
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				const value = response.value as { choice?: string; actions: object[] };
				if (value.choice !== "complete") return response;
				const { sources } = JSON.parse(request.prompt);
				const reads = sources.map(({ evidence }: { evidence: string }) => ({
					...value.actions[0],
					tool: "source_read",
					inputJson: JSON.stringify({ evidence, start: 0, limit: 200 }),
				}));
				return {
					...response,
					value: request.schema.parse({
						...value,
						actions: [...reads, ...value.actions],
					}),
				};
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.attempts).toHaveLength(view.input.policy.budget.attempts);
		expect(view.attempts.at(-1)?.tool).toBe("report_read");
		expect(view.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(
			events.filter(
				(e) => e.kind === "model_finished" && e.purpose === "grade",
			),
		).toHaveLength(1);
	} finally {
		await host.close();
	}
});

test("successful tool without progress cannot repeat the identical action", async () => {
	const { options } = await config("museum", {
		generator: scripted("museum", { repeat: true }),
	});
	const host = await openExample(options);
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("incomplete");
		expect(view.report?.reason).toContain("unchanged_operation");
		expect(view.attempts).toHaveLength(2);
	} finally {
		await host.close();
	}
});

test.each([false, true])(
	"partial finalization reuses a read-back artifact only if its content matches (changed=%s)",
	async (changed) => {
		const delegate = scripted("missing");
		let finalized = false;
		const { options, events } = await config("missing", {
			generator: {
				async complete(request, signal) {
					const result = await delegate.complete(request, signal);
					const value = result.value as {
						choice?: string;
						actions?: { inputJson: string }[];
					};
					if (value.choice !== "partial") return result;
					const packet = JSON.parse(request.prompt);
					if (!packet.report)
						return {
							...result,
							value: request.schema.parse({ ...value, choice: "act" }),
						};
					const state = JSON.parse(packet.state.split("\n\n").at(-1)!);
					expect(state.savedReadBack).toBe(4);
					expect(finalized).toBe(false);
					finalized = true;
					const [write, readBack] = value.actions!;
					const draft = {
						...packet.report,
						stopReason: "施設B本文を取得できず終了",
					};
					if (changed)
						draft.answer += "\n\n比較は施設Aの確認済み範囲に限ります。";
					return {
						...result,
						value: request.schema.parse({
							...value,
							actions: [
								{ ...write, inputJson: JSON.stringify(draft) },
								readBack,
							],
						}),
					};
				},
			},
		});
		const host = await openExample(options);
		try {
			const { view, markdown } = await host.drive();
			expect(view.status).toBe("incomplete");
			expect(view.report?.criteria.map((c) => c.passed)).toEqual([true, false]);
			expect(finalized).toBe(true);
			expect(view.attempts.map((a) => a.tool)).toEqual([
				"web_read",
				"web_read",
				"report_draft",
				"report_read",
				...(changed ? ["report_draft", "report_read"] : []),
			]);
			expect(view.progress?.at(-1)?.reusedArtifact).toEqual(
				changed ? undefined : { write: 3, readBack: 4 },
			);
			expect(
				events.filter(
					(e) => e.kind === "model_finished" && e.purpose === "grade",
				),
			).toHaveLength(1);
			expect(await readFile(markdown!, "utf8")).toBe(
				host.snapshot().state.draft!.answer,
			);
		} finally {
			await host.close();
		}
	},
);

test("saved pending decision survives restart and duplicate receipts are idempotent", async () => {
	const { options } = await config("museum");
	let host = await openExample(options);
	const first = await host.drive(undefined, (step) => !!step.pendingDecision);
	expect(first.paused).toBe(true);
	const operation = first.view.productive!.request!.id;
	await host.close();
	host = await openExample(options);
	try {
		const req = await host.engine.decisionRequest(host.coreId, operation);
		const response = await options.generator.complete(
			{
				...req,
				prompt: JSON.stringify({
					state: req.prompt,
					sources: [],
					report: null,
				}),
			},
			new AbortController().signal,
		);
		await host.engine.completeDecision(
			host.coreId,
			operation,
			response,
			host.runtime,
			new AbortController().signal,
		);
		const count = (await host.engine.view(host.coreId))!.inference.length;
		await host.engine.completeDecision(
			host.coreId,
			operation,
			response,
			host.runtime,
			new AbortController().signal,
		);
		expect((await host.engine.view(host.coreId))!.inference.length).toBe(count);
		await expect(
			host.engine.completeDecision(
				host.coreId,
				operation,
				{ ...response, latencyMs: 1000 },
				host.runtime,
				new AbortController().signal,
			),
		).rejects.toThrow("operation_conflict");
	} finally {
		await host.close();
	}
});

test("cancellation and deadline discard delayed results without publishing", async () => {
	for (const mode of ["cancel", "deadline"]) {
		const { options, events } = await config("museum", {
			wallMs: mode === "deadline" ? 100 : 10000,
			async web(_req, _signal) {
				await delay(150, new AbortController().signal);
				return {
					state: "finished",
					hits: [],
					failures: [],
					documents: [
						{
							url: "https://fixture.example/late",
							title: "late",
							text: "late",
							fetchedAt: 0,
							truncated: false,
						},
					],
				};
			},
		});
		const host = await openExample(options);
		const ctrl = new AbortController();
		const timer =
			mode === "cancel" ? setTimeout(() => ctrl.abort(), 35) : undefined;
		try {
			const { view, markdown } = await host.drive(ctrl.signal);
			expect(view.status).toBe("stopped");
			expect(markdown).toBeNull();
			expect(host.snapshot().documents).toHaveLength(0);
			expect(view.attempts.some((a) => a.state === "interrupted")).toBe(true);
		} finally {
			clearTimeout(timer);
			await host.close();
		}
		expect(events.some((e) => e.kind === "late_job_ignored")).toBe(true);
	}
});

test("while Markdown is being written, the controller can assess other work; wait state requests no new inference", async () => {
	const { options, events } = await config("museum", { markdownDelayMs: 55 });
	const f = fixture("museum", { lookup: 20, read: 180, stagger: 100 });
	const base = scripted("museum", { think: true });
	const host = await openExample({
		...options,
		web: f.web,
		generator: {
			async complete(request, signal) {
				if (
					request.purpose === "propose" &&
					"basis" in request.schema.toJSONSchema().properties!
				) {
					const packet = JSON.parse(request.prompt);
					const state = JSON.parse(packet.state.split("\n\n").at(-1));
					if (
						state.pending.some(
							(p: { tool: string }) => p.tool === "web_read",
						) &&
						!state.attempts.some(
							(p: { tool: string }) => p.tool === "report_draft",
						)
					) {
						const draft = {
							title: "資料比較",
							answer: "## 調査中\n指定資料の本文は確認中です。",
							summary: "確認中",
							completion: "incomplete",
							claims: [],
							limitations: ["本文取得中"],
							stopReason: "暫定保存",
						};
						return {
							model: "fixture",
							latencyMs: 0,
							inputTokens: null,
							outputTokens: null,
							cacheReadTokens: null,
							value: request.schema.parse({
								basis: state.basis,
								progress: {
									assessed: state.newlyUnassessed,
									kind: "none",
									change: "",
									criteria: [],
									evidence: [],
									conclusions: [],
								},
								choice: "act",
								route: "checkpoint",
								contribution: "依頼項目と未確認の範囲を先に保存",
								reason: "本文を取得中",
								missing: "",
								actions: [
									{
										tool: "report_draft",
										inputJson: JSON.stringify(draft),
										text: null,
										expectedStatus: "ok",
										expectedObservation: "暫定案が保存される",
										whatChanged: "",
										refutedIf: "保存結果が返らない",
									},
								],
								sequence: false,
								cancelPending: false,
								renewHypothesis: null,
								renewStrategy: null,
							}),
						};
					}
				}
				return base.complete(request, signal);
			},
		},
	});
	try {
		const paused = await host.drive(
			undefined,
			(step) =>
				step.workReady === false &&
				!step.pendingDecision &&
				!!step.pendingTools?.length,
		);
		expect(paused.paused).toBe(true);
		const count = paused.view.inference.length;
		for (let i = 0; i < 3; i++) {
			const noWork = await host.engine.step(
				host.coreId,
				host.runtime,
				new AbortController().signal,
			);
			expect(noWork.pendingDecision).toBeUndefined();
			expect(noWork.workReady).toBe(false);
		}
		expect((await host.engine.view(host.coreId))!.inference).toHaveLength(
			count,
		);
		const final = await host.drive();
		expect(final.view.status).toBe("completed");
		const begin = events.findIndex(
			(e) => e.kind === "job_started" && e.job === "markdown",
		);
		const end = events.findIndex(
			(e) => e.kind === "job_ready" && e.job === "markdown",
		);
		expect(
			events
				.slice(begin, end)
				.some((e) => e.kind === "model_finished" && e.purpose === "propose"),
		).toBe(true);
		expect(
			final.view.attempts.filter((a) => a.tool === "report_draft"),
		).toHaveLength(2);
	} finally {
		await host.close();
	}
});

test("a result can be adopted while a controller is still running; its stale action is never executed", async () => {
	const { options, events } = await config("museum");
	const model = scripted("museum");
	const host = await openExample({
		...options,
		generator: {
			async complete(request, signal) {
				if (
					request.purpose === "propose" &&
					"basis" in request.schema.toJSONSchema().properties!
				) {
					const packet = JSON.parse(request.prompt);
					const state = JSON.parse(packet.state.split("\n\n").at(-1));
					if (state.pending.length) {
						await delay(100, signal);
						return {
							model: "fixture",
							latencyMs: 100,
							inputTokens: null,
							outputTokens: null,
							cacheReadTokens: null,
							value: request.schema.parse({
								basis: state.basis,
								progress: {
									assessed: state.newlyUnassessed,
									kind: "none",
									change: "",
									criteria: [],
									evidence: [],
									conclusions: [],
								},
								choice: "act",
								route: "alternative",
								contribution: "別資料を探す",
								reason: "本文が未着",
								missing: "",
								actions: [
									{
										tool: "web_lookup",
										inputJson: '{"query":"stale","language":"en"}',
										text: null,
										expectedStatus: "ok",
										expectedObservation: "候補が返る",
										whatChanged: "",
										refutedIf: "候補がない",
									},
								],
								sequence: false,
								cancelPending: false,
								renewHypothesis: null,
								renewStrategy: null,
							}),
						};
					}
				}
				return model.complete(request, signal);
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		expect(
			view.progress?.filter((p) => p.status === "superseded"),
		).toHaveLength(1);
		expect(view.attempts.some((a) => a.tool === "web_lookup")).toBe(false);
		const receipt = events.findIndex(
			(e) => e.kind === "tool_adopted" && e.job === "read",
		);
		const before = events.slice(0, receipt);
		const modelNumber = before
			.filter((e) => e.kind === "model_started")
			.at(-1)?.number;
		expect(
			before.some(
				(e) => e.kind === "model_finished" && e.number === modelNumber,
			),
		).toBe(false);
	} finally {
		await host.close();
	}
});

test("a declared dependency parks the dispatched batch without a model turn to rediscover waiting", async () => {
	const { options, events } = await config("museum");
	const base = scripted("museum");
	const host = await openExample({
		...options,
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose !== "propose") return response;
				const value = response.value as {
					progress: { kind: string };
					choice: string;
				};
				return value.progress.kind === "initial" && value.choice === "act"
					? {
							...response,
							value: request.schema.parse({
								...value,
								waitAfterDispatch: true,
							}),
						}
					: response;
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		const start = events.findIndex(
			(e) => e.kind === "job_started" && e.job === "read",
		);
		const firstReady = events.findIndex(
			(e) => e.kind === "job_ready" && e.job === "read",
		);
		expect(
			events
				.slice(start, firstReady)
				.filter((e) => e.kind === "job_started" && e.job === "read"),
		).toHaveLength(2);
		expect(
			events.slice(start, firstReady).some((e) => e.kind === "model_started"),
		).toBe(false);
		expect(
			events.slice(firstReady).some((e) => e.kind === "model_started"),
		).toBe(true);
	} finally {
		await host.close();
	}
});

test("two pursuits share one inference slot only in the separate contention trial", async () => {
	const a = await config("museum");
	const b = await config("technical");
	let active = 0,
		peak = 0,
		queueMs = 0,
		tail = Promise.resolve();
	const slot = (
		generator: HostOptions["generator"],
	): HostOptions["generator"] => ({
		complete(request, signal) {
			const queued = performance.now();
			const run = tail.then(async () => {
				queueMs += performance.now() - queued;
				active++;
				peak = Math.max(peak, active);
				try {
					await delay(4, signal);
					return await generator.complete(request, signal);
				} finally {
					active--;
				}
			});
			tail = run.then(
				() => {},
				() => {},
			);
			return run;
		},
	});
	const first = await openExample({
		...a.options,
		generator: slot(a.options.generator),
	});
	const second = await openExample({
		...b.options,
		generator: slot(b.options.generator),
	});
	try {
		const runs = await Promise.all([first.drive(), second.drive()]);
		expect(runs.map((r) => r.view.status)).toEqual(["completed", "completed"]);
		expect(peak).toBe(1);
		expect(queueMs).toBeGreaterThan(0);
	} finally {
		await Promise.all([first.close(), second.close()]);
	}
});

test("a refused search establishes a constraint without stopping permitted known-source reads", async () => {
	const { options } = await config("denied");
	const base = scripted("denied");
	const f = fixture("denied");
	const action = (
		tool: string,
		input: object,
		expectedStatus: "ok" | "error",
	) => ({
		tool,
		inputJson: JSON.stringify(input),
		text: null,
		expectedStatus,
		expectedObservation: "許可または拒否の結果が記録される",
		refutedIf: "対象に対応する記録がない",
		whatChanged: "",
	});
	const host = await openExample({
		...options,
		generator: {
			async complete(request, signal) {
				const r = await base.complete(request, signal);
				if (request.purpose !== "propose") return r;
				const value = r.value as {
					progress: { kind: string; assessed: number[] };
					choice: string;
				};
				const packet = JSON.parse(request.prompt);
				const state = JSON.parse(packet.state.split("\n\n").at(-1));
				if (value.progress.kind === "initial")
					return {
						...r,
						value: request.schema.parse({
							...value,
							actions: [
								action(
									"web_lookup",
									{ query: "fixture", language: "ja" },
									"error",
								),
							],
							waitAfterDispatch: true,
						}),
					};
				if (
					state.attempts.length === 1 &&
					state.attempts[0].error === "guard_denied"
				)
					return {
						...r,
						value: request.schema.parse({
							...value,
							choice: "act",
							sequence: false,
							waitAfterDispatch: true,
							route: "alternative",
							reason: "検索は拒否された。指定URLの取得は別の許可された操作。",
							contribution: "検索を繰り返さず指定資料の本文を確認",
							actions: f.sources.map((s) =>
								action("web_read", { url: s.url }, "ok"),
							),
							progress: {
								...value.progress,
								kind: "constraint",
								change: "検索経路は拒否された",
								criteria: ["answer"],
								evidence: [1],
							},
						}),
					};
				return r;
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(view.attempts[0]?.observation?.errorCode).toBe("guard_denied");
		expect(
			view.progress?.find((p) => p.verdict.kind === "constraint")?.choice.route,
		).toBe("alternative");
		expect(view.attempts.filter((a) => a.tool === "web_lookup")).toHaveLength(
			1,
		);
		expect(view.attempts.filter((a) => a.tool === "web_read")).toHaveLength(2);
	} finally {
		await host.close();
	}
});

test("a rejected save is a logistical constraint, and corrected finalization preserves acquired facts", async () => {
	const { options } = await config("museum");
	const base = scripted("museum");
	let rejected = false;
	const host = await openExample({
		...options,
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose !== "propose") return response;
				const v = response.value as {
					choice: string;
					actions: { expectedObservation: string; refutedIf: string }[];
					progress: { kind: string; assessed: number[] };
				};
				if (v.choice === "complete" && !rejected) {
					rejected = true;
					v.actions[0]!.refutedIf = v.actions[0]!.expectedObservation;
				} else if (
					v.choice === "complete" &&
					v.progress.kind === "constraint"
				) {
					Object.assign(v.progress, {
						criteria: [],
						evidence: v.progress.assessed,
					});
				}
				return { ...response, value: request.schema.parse(v) };
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		const refusal = view.attempts.find((a) => a.state === "rejected");
		expect(refusal?.rejection?.[0]?.rule).toBe("prediction_not_falsifiable");
		expect(
			view.progress?.some(
				(p) =>
					p.verdict.kind === "constraint" &&
					p.verdict.evidence.includes(refusal!.seq),
			),
		).toBe(true);
		expect(
			host.snapshot().state.draft?.claims.every((c) => c.evidence.length),
		).toBe(true);
	} finally {
		await host.close();
	}
});

test("the final verifier cannot extend a cancellation even when it ignores its signal", async () => {
	const { options } = await config("museum");
	const host = await openExample(options);
	const controller = new AbortController();
	let requested = 0;
	host.runtime.acceptance.verify = () => {
		requested++;
		queueMicrotask(() => controller.abort());
		return new Promise(() => {});
	};
	try {
		const { view, markdown } = await host.drive(controller.signal);
		expect(requested).toBe(1);
		expect(view.status).toBe("stopped");
		expect(view.report?.verified).toBe(false);
		expect(markdown).toBeNull();
		expect(host.snapshot().state.draft?.claims).toHaveLength(2);
	} finally {
		await host.close();
	}
});

test("a full strategy can checkpoint acquired evidence, renew scope, and finish", async () => {
	const base = scripted("museum");
	const f = fixture("museum", { lookup: 1, read: 1, stagger: 1 });
	const extras = ["context-a", "context-b"].map((name) => ({
		url: "https://fixture.example/" + name,
		title: name,
		text: "比較の対象範囲を説明する補足資料。",
		fetchedAt: 0,
		truncated: false,
	}));
	const ordered = [...extras, ...f.sources];
	const action = (tool: string, input: object) => ({
		tool,
		inputJson: JSON.stringify(input),
		text: null,
		expectedStatus: "ok",
		expectedObservation: "指定した資料または保存記録が得られる",
		whatChanged: "比較に必要な根拠を取得または保存する",
		refutedIf: "対象が異なるか記録がない",
	});
	const { events, options } = await config("museum", {
		markdownDelayMs: 30,
		async web(request, signal) {
			const extra = extras.find(
				({ url }) => url === (request.arguments as { url?: string }).url,
			);
			return extra
				? { state: "finished", hits: [], documents: [extra], failures: [] }
				: f.web(request, signal);
		},
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose !== "propose") return response;
				const packet = JSON.parse(request.prompt);
				const state = JSON.parse(packet.state.split("\n\n").at(-1));
				const choice = response.value as Record<string, unknown>;
				if (state.pending.length) return response;
				const source = ordered[packet.sources.length];
				if (!source)
					return {
						...response,
						value: request.schema.parse({ ...choice, choice: "complete" }),
					};
				const renewing = state.choiceViolations.includes("hypothesis_budget");
				const actions = [action("web_read", { url: source.url })];
				const hypothesis = {
					body: "次の資料を照合する",
					expected: "指定本文を確認できる",
					targets: [source.url],
				};
				if (packet.sources.length === 3)
					expect(state.remainingHypothesisRenewals).toBe(0);
				if (renewing) {
					expect(state.remainingStrategyRenewals).toBeGreaterThan(0);
					expect(state.attemptsPerNewHypothesis).toBeGreaterThanOrEqual(2);
					const known = f.sources[0]!;
					const reference = packet.sources.find(
						(d: { url: string }) => d.url === known.url,
					);
					actions.unshift(
						action("report_draft", {
							completion: "incomplete",
							title: "資料比較",
							answer: known.text + " " + known.url,
							summary: "施設Aを確認済み",
							claims: [
								{
									text: known.text,
									status: "verified",
									evidence: [reference.evidence],
								},
							],
							limitations: ["施設Bは未確認"],
							stopReason: "残る本文の取得前に根拠を保存",
						}),
					);
				}
				return {
					...response,
					value: request.schema.parse({
						...choice,
						choice: "act",
						actions,
						sequence: false,
						waitAfterDispatch: true,
						renewHypothesis: hypothesis,
						renewStrategy: renewing
							? {
									body: "確定した比較条件を保存し、未確認資料を照合する",
									rationale: "既存方針は仮説数の上限に達した",
									parts: ["本文取得と比較"],
									alternatives: [],
								}
							: null,
					}),
				};
			},
		},
	});
	const host = await openExample(options);
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		expect(view.strategies).toHaveLength(2);
		expect(
			view.hypotheses.filter((h) => h.strategyId === view.strategies[0]?.id),
		).toHaveLength(4);
		expect(
			view.progress
				?.find((p) => p.choice.renewStrategy)
				?.choice.actions.map((a) => a.tool),
		).toEqual(["report_draft", "web_read"]);
		const checkpoint = view.attempts.find((a) => a.tool === "report_draft")!;
		expect(checkpoint.input).toMatchObject({
			completion: "incomplete",
			claims: [
				{ text: f.sources[0]!.text, status: "verified", evidence: ["e3"] },
			],
		});
		const nextRead = view.attempts.find((a) => a.seq === checkpoint.seq + 1)!;
		expect(nextRead.input).toEqual({ url: f.sources[1]!.url });
		const readJob = events.find(
			(event) =>
				event.kind === "tool_adopted" && event.attemptId === nextRead.id,
		);
		const saved = events.findIndex(
			(event) =>
				event.kind === "tool_adopted" && event.attemptId === checkpoint.id,
		);
		const finalRead = events.findIndex(
			(event) => event.kind === "job_started" && event.id === readJob?.id,
		);
		expect(saved).toBeGreaterThanOrEqual(0);
		expect(finalRead).toBeGreaterThan(saved);
	} finally {
		await host.close();
	}
});

test("the final grade checks the current Markdown bytes and rejects a corrupt artifact", async () => {
	const base = scripted("museum");
	const gradePackets: unknown[] = [];
	const { events, options } = await config("museum", {
		generator: {
			async complete(request, signal) {
				if (request.purpose === "grade")
					gradePackets.push(
						JSON.parse(JSON.parse(request.prompt).state).markdownSave,
					);
				return base.complete(request, signal);
			},
		},
	});
	const host = await openExample(options);
	const signal = new AbortController().signal;
	try {
		const paused = await host.drive(signal, () =>
			events.some(
				(event) => event.kind === "tool_adopted" && event.job === "markdown",
			),
		);
		expect(paused.paused).toBe(true);
		const saved = events.find((event) => event.kind === "markdown_saved")!;
		const original = await host.runtime.acceptance.verify(signal);
		expect(
			original.find((criterion) => criterion.id === "answer")?.passed,
		).toBe(true);
		expect(gradePackets[0]).toMatchObject({
			attempt: paused.view.attempts.at(-1)?.seq,
			mediaType: "text/markdown",
			bytes: saved.bytes,
			sha256: saved.hash,
		});
		const staged = join(options.directory, "private", saved.id + ".md");
		const file = await readFile(staged);
		file[0] = file[0]! ^ 1;
		await writeFile(staged, file);
		const corrupted = await host.runtime.acceptance.verify(signal);
		expect(
			corrupted.find((criterion) => criterion.id === "answer")?.passed,
		).toBe(false);
		expect(gradePackets[1]).toBeNull();
	} finally {
		await host.close();
	}
});

test("restart does not repeat an external call of unknown outcome or lose an accepted receipt", async () => {
	const f = fixture("museum", { lookup: 10, read: 15, stagger: 100 });
	const base = scripted("museum");
	let webCalls = 0;
	const { options } = await config("museum", {
		async web(request, signal) {
			webCalls++;
			return f.web(request, signal);
		},
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose !== "propose") return response;
				const v = response.value as { progress: { kind: string } };
				return v.progress.kind === "initial"
					? {
							...response,
							value: request.schema.parse({ ...v, waitAfterDispatch: true }),
						}
					: response;
			},
		},
	});
	let host = await openExample(options);
	try {
		const paused = await host.drive(
			undefined,
			(step) => step.event === "executed" && step.pendingTools?.length === 1,
		);
		expect(paused.paused).toBe(true);
		expect(host.snapshot().documents.map((d) => d.url)).toEqual([
			"https://fixture.example/b",
		]);
		await host.close();
		host = await openExample(options);
		const { view } = await host.drive();
		expect(webCalls).toBe(2);
		expect(
			view.attempts.some(
				(a) => a.observation?.errorCode === "web_outcome_unknown",
			),
		).toBe(true);
		expect(host.snapshot().documents.map((d) => d.id)).toEqual(["e1"]);
		expect(host.snapshot().state.draft?.claims[1]?.evidence).toEqual(["e1"]);
		expect(view.status).toBe("incomplete");
	} finally {
		await host.close();
	}
});

test("an unchanged failed final verification cannot trigger another grade", async () => {
	const { options } = await config("museum");
	const host = await openExample(options);
	let grades = 0;
	host.runtime.acceptance.verify = async () => {
		grades++;
		return [
			{
				id: "citations",
				passed: true,
				evidence: "valid references",
				assurance: "exact",
			},
			{
				id: "answer",
				passed: false,
				evidence: "unmet request",
				assurance: "model",
			},
		];
	};
	try {
		const { view } = await host.drive();
		expect(grades).toBe(1);
		expect(view.status).toBe("incomplete");
		expect(view.report?.verified).toBe(false);
		expect(view.report?.reason).toContain("unchanged_failed_claim");
	} finally {
		await host.close();
	}
});

test("reopening after a terminal write failure reuses the stored verdict and plan", async () => {
	const { options, events } = await config("missing");
	let host = await openExample(options);
	try {
		const db = new Database(join(options.directory, "example.sqlite"));
		try {
			db.exec(
				"CREATE TRIGGER fixture_fail_finish BEFORE INSERT ON pursuit_report BEGIN SELECT RAISE(ABORT, 'fixture_storage_failure'); END",
			);
			await expect(host.drive()).rejects.toThrow("fixture_storage_failure");
			const interrupted = (await host.engine.view(host.coreId))!;
			expect(interrupted.report).toBeNull();
			expect(interrupted.productive?.plan?.finish).toBe("incomplete");
			expect(interrupted.verifications.map((v) => v.trigger)).toEqual([
				"claim",
			]);
			db.exec("DROP TRIGGER fixture_fail_finish");
		} finally {
			db.close();
		}
		await host.close();
		const countBefore = events.filter((e) => e.kind === "model_started").length;
		host = await openExample(options);
		const { view, markdown } = await host.drive();
		expect(view.status).toBe("incomplete");
		expect(view.report?.criteria.map((c) => c.passed)).toEqual([true, false]);
		expect(view.verifications.map((v) => v.trigger)).toEqual([
			"claim",
			"final",
		]);
		expect(await readFile(markdown!, "utf8")).toBe(
			host.snapshot().state.draft!.answer,
		);
		expect(events.filter((e) => e.kind === "model_started")).toHaveLength(
			countBefore,
		);
	} finally {
		await host.close();
	}
});

test("an unavailable verifier leaves the saved report eligible for reverify", async () => {
	const { options } = await config("museum");
	const host = await openExample(options);
	const verify = host.runtime.acceptance.verify;
	let calls = 0;
	host.runtime.acceptance.verify = async (signal) => {
		if (++calls === 1) throw new Error("fixture_verifier_unavailable");
		const pending = (await host.engine.view(host.coreId))!.report;
		expect(pending?.verificationIssue).toBe("failed");
		return verify(signal);
	};
	try {
		const { view, markdown } = await host.drive();
		expect(calls).toBe(2);
		expect(view.status).toBe("incomplete");
		expect(view.report?.verified).toBe(true);
		expect(view.report?.verificationIssue).toBeUndefined();
		expect(view.attempts.filter((a) => a.tool === "report_draft")).toHaveLength(
			1,
		);
		expect(await readFile(markdown!, "utf8")).toBe(
			host.snapshot().state.draft!.answer,
		);
	} finally {
		await host.close();
	}
});

test.each(["renew", "consult"] as const)(
	"%s and its decision receipt commit together across a storage failure",
	async (kind) => {
		const { options } = await config("museum");
		const host = await openExample(options);
		const db = new Database(join(options.directory, "example.sqlite"));
		const signal = new AbortController().signal;
		try {
			const paused = await host.drive(signal, (step) => !!step.pendingDecision);
			const captured = paused.view.productive!.request!;
			const req = await host.engine.decisionRequest(host.coreId, captured.id);
			const original = await options.generator.complete(
				{
					...req,
					prompt: JSON.stringify({
						state: req.prompt,
						sources: [],
						report: null,
					}),
				},
				signal,
			);
			const value = original.value as Record<string, unknown>;
			const response = {
				...original,
				value: req.schema.parse({
					...value,
					...(kind === "renew"
						? {
								renewHypothesis: {
									body: "出典版を直接調べる",
									expected: "指定本文を確認できる",
									targets: ["report.json"],
								},
							}
						: {
								choice: "consult",
								actions: [],
								missing: "比較対象の版",
								reason: "どの版を比較しますか",
							}),
				}),
			};
			const table =
				kind === "renew" ? "pursuit_progress" : "pursuit_consultation";
			db.exec(
				`CREATE TRIGGER fixture_fail_save BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'fixture_storage_failure'); END`,
			);
			await expect(
				host.engine.completeDecision(
					host.coreId,
					captured.id,
					response,
					host.runtime,
					signal,
				),
			).rejects.toThrow("fixture_storage_failure");
			const uncommitted = (await host.engine.view(host.coreId))!;
			expect(uncommitted.revision).toBe(paused.view.revision);
			expect(uncommitted.hypotheses).toHaveLength(1);
			expect(uncommitted.consultations).toHaveLength(0);
			expect(uncommitted.inference).toHaveLength(2);
			expect(uncommitted.productive?.request?.id).toBe(captured.id);
			db.exec("DROP TRIGGER fixture_fail_save");
			await host.engine.completeDecision(
				host.coreId,
				captured.id,
				response,
				host.runtime,
				signal,
			);
			await host.engine.completeDecision(
				host.coreId,
				captured.id,
				response,
				host.runtime,
				signal,
			);
			const committed = (await host.engine.view(host.coreId))!;
			expect(committed.progress).toHaveLength(1);
			expect(committed.inference).toHaveLength(3);
			expect(committed.hypotheses).toHaveLength(kind === "renew" ? 2 : 1);
			expect(committed.consultations).toHaveLength(kind === "consult" ? 1 : 0);
		} finally {
			db.close();
			await host.close();
		}
	},
);

test("conflicting records beyond the Web preview are checked against both stored bodies before grading", async () => {
	const { options } = await config("conflict");
	const f = fixture("conflict", { lookup: 10, read: 20, stagger: 10 });
	const base = scripted("conflict");
	const padding = "注".repeat(13000);
	const host = await openExample({
		...options,
		async web(request, signal) {
			const result = await f.web(request, signal);
			return {
				...result,
				documents: result.documents.map((d) =>
					d.url.endsWith("/a") ? d : { ...d, text: padding + d.text },
				),
			};
		},
		generator: {
			async complete(request, signal) {
				const response = await base.complete(request, signal);
				if (request.purpose === "grade") {
					const { evidence } = JSON.parse(JSON.parse(request.prompt).state) as {
						evidence: { url: string; excerpts: unknown[] }[];
					};
					for (const source of f.sources.slice(1)) {
						expect(
							evidence.find((item) => item.url === source.url)?.excerpts,
						).toEqual([
							{ start: 0, text: padding + source.text, clipped: false },
						]);
					}
				}
				if (request.purpose !== "propose") return response;
				const v = response.value as {
					choice: string;
					actions: { inputJson: string }[];
					progress: { kind: string; evidence: number[] };
				};
				if (v.choice !== "complete") return response;
				const packet = JSON.parse(request.prompt);
				const snapshot = JSON.parse(packet.state.split("\n\n").at(-1));
				const reads = snapshot.attempts.filter(
					(a: { tool: string }) => a.tool === "source_read",
				);
				const refs = f.sources
					.slice(1)
					.map(
						(s) =>
							packet.sources.find((d: { url: string }) => d.url === s.url)
								.evidence,
					);
				if (!reads.length)
					return {
						...response,
						value: request.schema.parse({
							...v,
							choice: "act",
							sequence: false,
							route: "verify",
							contribution: "版の適用範囲を両方の保存本文で照合する",
							actions: refs.map((evidence) => ({
								tool: "source_read",
								inputJson: JSON.stringify({
									evidence,
									start: padding.length,
									limit: 600,
								}),
								text: null,
								expectedStatus: "ok",
								expectedObservation: "現行または旧版の規則本文が返る",
								refutedIf: "適用時点の根拠が取得できない",
								whatChanged: "",
							})),
						}),
					};
				const report = JSON.parse(v.actions[0]!.inputJson);
				report.answer +=
					"\n\n現行案内を優先し、失効済み旧版の三脚可は現行の規則に適用しない。";
				report.claims.push({
					status: "conflicting",
					evidence: refs,
					text: "現行と旧版で三脚の扱いが異なる。旧版は失効済み。",
				});
				v.actions[0]!.inputJson = JSON.stringify(report);
				return {
					...response,
					value: request.schema.parse({
						...v,
						progress: {
							...v.progress,
							kind: "evidence",
							change: "保存本文の再読で現行と失効旧版の違いを確認",
							criteria: ["answer"],
							evidence: reads.map((a: { seq: number }) => a.seq),
						},
						renewHypothesis: {
							body: "現行と旧版を区別した報告を照合する",
							expected: "双方の出典と適用範囲を読戻しできる",
							targets: ["report.json"],
						},
					}),
				};
			},
		},
	});
	try {
		const { view } = await host.drive();
		expect(view.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(
			view.attempts.filter(
				(a) => a.tool === "source_read" && a.observation?.status === "ok",
			),
		).toHaveLength(2);
		expect(
			host
				.snapshot()
				.state.draft?.claims.find((c) => c.status === "conflicting")?.evidence,
		).toHaveLength(2);
	} finally {
		await host.close();
	}
});

test("Steer takes only valid revisions, releases excess input, and does not resend an unknown delivery", () => {
	let now = 1_000;
	const inbox = createSteeringInbox({ now: () => now });
	const opened = inbox.open("pursuit:test", "1");
	if (opened.status !== "opened") throw new Error(opened.status);
	const { target } = opened;
	const event = (id: string, sourceRef: string, sourceRevision = "1") => ({
		id,
		sourceRef,
		sourceRevision,
	});
	expect(
		target.enqueue({ ...event("expired", "old"), expiresAt: now + 1 }).status,
	).toBe("accepted");
	expect(target.enqueue(event("outdated", "a", "0")).status).toBe("accepted");
	expect(target.enqueue(event("current", "a")).status).toBe("accepted");
	expect(target.enqueue(event("same-source", "a")).status).toBe("accepted");
	now += 2;
	const options = {
		target,
		boundaryId: "next",
		now: () => now,
		resolve: (ref: SteeringReference) =>
			ref.sourceRef === "a" && ref.sourceRevision === "1"
				? "確認済みの補足"
				: null,
		presented: [],
		remainingReferences: 32,
		maxSupplementBytes: 0,
	};
	expect(prepareSteering(options)).toBeNull();
	const prepared = prepareSteering({ ...options, maxSupplementBytes: 4096 })!;
	expect(prepared.input?.steering.references).toEqual([
		{ sourceRef: "a", sourceRevision: "1", text: "確認済みの補足" },
	]);
	prepared.settle("unknown");
	expect(target.claim("following").status).toBe("empty");
	expect(target.close()).toBe(1); // Includes the expired event, which was never delivered.
});

test("Steer delivers supplements received during reading only to the next existing productive decisions", async () => {
	const inbox = createSteeringInbox();
	const base = scripted("museum", { think: true });
	const { f, options, events } = await config("museum");
	let binding: { targetId: string; generation: string } | null = null;
	let sent = false;
	let pursuitId = "";
	const packets: { purpose: string; refs?: string[] }[] = [];
	const host = await openExample({
		...options,
		steering: {
			inbox,
			maxSupplementBytes: 4096,
			resolve: (_db, id, ref) =>
				id === pursuitId && ref.sourceRevision === "1"
					? "補足 " + ref.sourceRef
					: null,
		},
		async web(request, signal) {
			if (!sent && request.kind === "read") {
				sent = true;
				for (const [id, sourceRef] of [
					["one", "a"],
					["two", "b"],
					["same", "a"],
				]) {
					expect(
						inbox.enqueue(binding!.targetId, binding!.generation, {
							id: id!,
							sourceRef: sourceRef!,
							sourceRevision: "1",
						}).status,
					).toBe("accepted");
				}
			}
			return f.web(request, signal);
		},
		generator: {
			async complete(request, signal) {
				const packet = JSON.parse(request.prompt);
				const references = packet.steering?.references as
					| { sourceRef: string; text: string }[]
					| undefined;
				packets.push({
					purpose: request.purpose,
					...(references ? { refs: references.map((r) => r.sourceRef) } : {}),
				});
				if (references?.[0]?.sourceRef === "a") {
					expect(packet.steering.instruction).toContain("未信頼");
					expect(
						inbox.enqueue(binding!.targetId, binding!.generation, {
							id: "after-claim",
							sourceRef: "c",
							sourceRevision: "1",
						}).status,
					).toBe("accepted");
				}
				const response = await base.complete(request, signal);
				return references
					? {
							...response,
							value: request.schema.parse(
								Object.assign({}, response.value, {
									reason: `補足 ${references.map((ref) => ref.sourceRef).join(",")}`,
								}),
							),
						}
					: response;
			},
		},
	});
	try {
		binding = host.steeringTarget;
		pursuitId = host.coreId;
		expect(binding).not.toBeNull();
		const result = await host.drive();
		expect(result.view.status).toBe("completed");
		expect(result.view.report?.verified).toBe(true);
		expect(packets.filter((p) => p.refs)).toEqual([
			{ purpose: "propose", refs: ["a", "b"] },
			{ purpose: "propose", refs: ["c"] },
		]);
		expect(
			host.snapshot().state.steeringReferences?.map((r) => r.sourceRef),
		).toEqual(["a", "b", "c"]);
		expect(
			result.view.progress?.some(
				(p) => p.choice.reason === "補足 c" && p.status === "accepted",
			),
		).toBe(true);
		expect(
			inbox.enqueue(binding!.targetId, binding!.generation, {
				id: "late",
				sourceRef: "d",
				sourceRevision: "1",
			}).status,
		).toBe("not_open");
		const plain = await config("museum", {
			generator: scripted("museum", { think: true }),
		});
		const control = await openExample(plain.options);
		try {
			const run = await control.drive();
			expect(run.view.status).toBe("completed");
			expect(
				events.filter((e) => e.kind === "model_started").map((e) => e.purpose),
			).toEqual(
				plain.events
					.filter((e) => e.kind === "model_started")
					.map((e) => e.purpose),
			);
		} finally {
			await control.close();
		}
	} finally {
		await host.close();
	}
});

test.each(["during-inference", "after-save"] as const)(
	"Steer stops adoption if a referenced revision is revoked %s",
	async (when) => {
		const inbox = createSteeringInbox();
		const { options } = await config("museum");
		const base = scripted("museum");
		let valid = true;
		let used = false;
		const host = await openExample({
			...options,
			steering: {
				inbox,
				maxSupplementBytes: 4096,
				resolve: () => (valid ? "確認済み資料" : null),
			},
			log(event) {
				if (
					when === "after-save" &&
					used &&
					event.kind === "job_ready" &&
					event.job === "decision"
				)
					valid = false;
			},
			generator: {
				async complete(request, signal) {
					if (JSON.parse(request.prompt).steering) {
						used = true;
						if (when === "during-inference") valid = false;
					}
					return base.complete(request, signal);
				},
			},
		});
		try {
			const target = host.steeringTarget!;
			expect(
				inbox.enqueue(target.targetId, target.generation, {
					id: "first",
					sourceRef: "document",
					sourceRevision: "1",
				}).status,
			).toBe("accepted");
			const result = await host.drive();
			expect(used).toBe(true);
			expect(result.view.status).toBe("stopped");
			expect(result.view.report?.reason).toBe("steering_reference_revoked");
			expect(result.view.progress).toHaveLength(0);
			expect(result.view.attempts).toHaveLength(0);
			expect(result.markdown).toBeNull();
			expect(host.snapshot().state.steeringRevoked).toBe(true);
		} finally {
			await host.close();
		}
	},
);

test("reopening the example excludes an old Steer generation and its queued supplements", async () => {
	const inbox = createSteeringInbox();
	const { options } = await config("museum");
	let seen = 0;
	const makeOptions = () => ({
		...options,
		steering: { inbox, maxSupplementBytes: 4096, resolve: () => "資料" },
		generator: {
			async complete<T>(
				...args: Parameters<typeof options.generator.complete<T>>
			) {
				if (JSON.parse(args[0].prompt).steering) seen++;
				return options.generator.complete(...args);
			},
		},
	});
	const initial = await openExample(makeOptions());
	const old = initial.steeringTarget!;
	const event = { id: "pending", sourceRef: "doc", sourceRevision: "1" };
	try {
		expect(inbox.enqueue(old.targetId, old.generation, event).status).toBe(
			"accepted",
		);
	} finally {
		await initial.close();
	}
	const reopened = await openExample(makeOptions());
	try {
		expect(reopened.coreId).toBe(initial.coreId);
		expect(reopened.steeringTarget?.targetId).toBe(old.targetId);
		expect(inbox.enqueue(old.targetId, old.generation, event).status).toBe(
			"generation_conflict",
		);
		expect((await reopened.drive()).view.status).toBe("completed");
		expect(seen).toBe(0);
	} finally {
		await reopened.close();
	}
});
