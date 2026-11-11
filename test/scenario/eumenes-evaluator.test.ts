import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evaluatorModel,
	reviewReport,
} from "../../examples/eumenes/evaluator.ts";
import { fixture, scripted } from "../../examples/eumenes/fixtures.ts";
import { openExample } from "../../examples/eumenes/host.ts";

test("example saves an independent Evaluator receipt after the normal pursuit", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pursuit-evaluator-"));
	try {
		const proc = Bun.spawn(
			[
				process.execPath,
				"examples/eumenes/run.ts",
				"fixture",
				"productive",
				"museum,missing",
				directory,
				"--evaluator",
			],
			{ cwd: join(import.meta.dir, "../.."), stderr: "pipe" },
		);
		const [exit, error] = await Promise.all([
			proc.exited,
			new Response(proc.stderr).text(),
		]);
		expect({ exit, error }).toEqual({ exit: 0, error: "" });
		const summary = await Bun.file(join(directory, "summary.json")).json();
		expect(summary.map((row: { status: string }) => row.status)).toEqual([
			"completed",
			"incomplete",
		]);
		for (const name of ["museum", "missing"]) {
			const receipt = await Bun.file(
				join(directory, name, "evaluation.json"),
			).json();
			const audit = await Bun.file(join(directory, name, "audit.json")).json();
			const events = (
				await Bun.file(join(directory, name, "events.jsonl")).text()
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(receipt.status).toBe("completed");
			expect(receipt.inputDigest).toMatch(/^[a-f0-9]{64}$/);
			expect(receipt.target.id).toBe(audit.stats.report.pursuitId);
			expect(audit.stats.evaluation.status).toBe(receipt.status);
			expect(events.at(-2)?.kind).toBe("evaluation_started");
			expect(events.at(-1)?.kind).toBe("evaluation_finished");
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Evaluator marks missing and clipped citations unverified even if the model marks them checked", async () => {
	let calls = 0;
	const model = evaluatorModel({
		async complete(request, signal) {
			calls++;
			signal.throwIfAborted();
			expect(request.purpose).toBe("grade");
			const packet = JSON.parse(request.prompt);
			expect(packet.originalRequest).toBe("本文を照合してください。");
			expect(packet.evidence.map((item: { id: string }) => item.id)).toEqual([
				"workflow",
				"e1",
			]);
			expect(packet.evidence[0].document.report.answer).toBe("確認対象");
			const value = request.schema.parse({
				findings: [],
				scopeChecks: ["workflow", "e1", "e2"].map((evidenceId) => ({
					evidenceId,
					status: "checked",
					reason: null,
				})),
				conditionChecks: [],
			});
			return {
				value,
				model: "fixture",
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: null,
				latencyMs: 0,
			};
		},
	});
	const doc = {
		id: "e1",
		url: "https://fixture.example/e1",
		title: "資料",
		text: "冒頭のみ",
		fetched_at: 0,
		truncated: 1,
	};
	const result = await reviewReport(
		{
			pursuitId: "pursuit-1",
			request: "本文を照合してください。",
			report: {
				completion: "complete",
				answer: "確認対象",
				summary: "確認対象",
				claims: [
					{
						text: "確認済みの申告",
						status: "verified",
						evidence: ["e1", "e2"],
					},
				],
				limitations: [],
				stopReason: "確認済み",
			},
			documents: [doc, { ...doc, id: "e3", truncated: 0 }],
		},
		model,
		new AbortController().signal,
	);
	expect(calls).toBe(1);
	expect(result.status).toBe("incomplete");
	expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
	expect(result.scopeChecks).toEqual([
		{ evidenceId: "workflow", status: "checked", reason: null },
		{
			evidenceId: "e1",
			status: "unverified",
			reason: "資料が切り詰められています",
		},
		{ evidenceId: "e2", status: "unverified", reason: "資料がありません" },
	]);
});

test.each(["correct the draft", "verify an unchanged draft"] as const)(
	"Pursuit uses the completed review to %s",
	async (scenario) => {
		const unchanged = scenario === "verify an unchanged draft";
		const directory = await mkdtemp(join(tmpdir(), "pursuit-evaluator-tool-"));
		const research = fixture("museum", { lookup: 1, read: 1, stagger: 1 });
		const base = scripted("museum");
		const question = "施設Bの三脚に関する記述は現行案内に合っていますか。";
		const finding = "施設Bでは三脚の使用が禁止されています。";
		const events: Record<string, unknown>[] = [];
		const host = await openExample({
			directory,
			execution: "productive",
			request: research.request,
			web: research.web,
			log: (event) => events.push(event),
			evaluator: {
				async complete(request) {
					const packet = JSON.parse(request.prompt);
					const { report, reviewQuestion } = packet.evidence[0].document;
					expect(reviewQuestion).toBe(question);
					if (!unchanged)
						expect(report.answer).toContain("施設Bでは三脚が使える。");
					const reference = packet.evidence.find(
						(item: { document: { url?: string } }) =>
							item.document.url === research.sources[1]!.url,
					);
					const value = request.schema.parse({
						findings: unchanged
							? []
							: [
									{
										title: "三脚の条件",
										problem: finding,
										trigger: "施設Bの常設展示",
										impact: "誤った来館案内",
										severity: "high",
										primary: {
											evidenceId: "workflow",
											startLine: null,
											endLine: null,
											pointer: "/report/answer",
										},
										evidence: [
											{
												evidenceId: reference.id,
												startLine: null,
												endLine: null,
												pointer: "/text",
											},
										],
										conditionId: null,
									},
								],
						scopeChecks: packet.scope.map((evidenceId: string) => ({
							evidenceId,
							status: "checked",
							reason: null,
						})),
						conditionChecks: [],
					});
					return {
						value,
						model: "fixture",
						inputTokens: 10,
						outputTokens: 20,
						cacheReadTokens: null,
						latencyMs: 0,
					};
				},
			},
			generator: {
				async complete(request, signal) {
					const response = await base.complete(request, signal);
					if (request.purpose === "grade") {
						const packet = JSON.parse(JSON.parse(request.prompt).state);
						if (unchanged && !packet.reportReviews)
							return {
								...response,
								value: request.schema.parse({
									passed: false,
									evidence: "別担当の点検記録がない",
								}),
							};
						expect(packet.reportReviews).toMatchObject([
							{
								question,
								matchesCurrentDraft: unchanged,
								findingsCount: unchanged ? 0 : 1,
							},
						]);
					}
					if (request.purpose !== "propose") return response;
					const choice = response.value as {
						choice: string;
						actions: { inputJson: string }[];
						progress: object;
					};
					if (choice.choice !== "complete") return response;
					const packet = JSON.parse(request.prompt);
					const snapshot = JSON.parse(packet.state.split("\n\n").at(-1));
					const draft = JSON.parse(choice.actions[0]!.inputJson);
					const priorReview = snapshot.attempts.find(
						(a: { tool: string }) => a.tool === "report_review",
					);
					if (!packet.report) {
						if (unchanged) return response;
						draft.completion = "incomplete";
						draft.answer += "\n施設Bでは三脚が使える。";
						return {
							...response,
							value: request.schema.parse({
								...choice,
								choice: "act",
								actions: [
									{ ...choice.actions[0], inputJson: JSON.stringify(draft) },
								],
							}),
						};
					}
					if (!priorReview) {
						return {
							...response,
							value: request.schema.parse({
								...choice,
								choice: "act",
								waitAfterDispatch: true,
								actions: [
									{
										tool: "report_review",
										inputJson: JSON.stringify({ question }),
										text: null,
										expectedStatus: "ok",
										expectedObservation:
											"施設Bの三脚の記述に対する独立した照合が返る",
										whatChanged: "報告に残った例外の適用を確認",
										refutedIf: "対象の記述や根拠を確認できない",
									},
								],
							}),
						};
					}
					if (!unchanged) expect(priorReview.observation).toContain(finding);
					return {
						...response,
						value: request.schema.parse({
							...choice,
							...(unchanged ? { actions: [] } : {}),
							progress: {
								...choice.progress,
								kind: "reasoning",
								evidence: [priorReview.seq],
								criteria: ["answer"],
								change: unchanged
									? "独立点検が完了し、完成済みの報告を最終検証できる"
									: "Evaluatorの指摘を現行案内と照合し記述を訂正する",
							},
						}),
					};
				},
			},
		});
		try {
			const { view, markdown } = await host.drive();
			expect(view.status).toBe("completed");
			expect(view.report?.verified).toBe(true);
			const review = view.attempts.find((a) => a.tool === "report_review")!;
			expect(review.observation?.output).toMatchObject({
				status: "completed",
				findings: unchanged ? [] : [{ problem: finding }],
				trust: "untrusted",
			});
			expect(
				view.attempts
					.filter((a) => a.tool === "report_draft")
					.map((a) => a.seq),
			).toEqual(
				unchanged ? [review.seq - 2] : [review.seq - 1, review.seq + 1],
			);
			expect(
				view.verifications
					.filter((record) => record.trigger === "claim")
					.map((record) => record.passed),
			).toEqual(unchanged ? [false, true] : [true]);
			expect(await Bun.file(markdown!).text()).not.toContain(
				"施設Bでは三脚が使える。",
			);
			expect(
				events.filter(
					(event) =>
						event.kind === "model_finished" &&
						event.channel === "evaluator_tool",
				),
			).toHaveLength(1);
		} finally {
			await host.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
