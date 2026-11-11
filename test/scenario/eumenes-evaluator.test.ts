import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evaluatorModel,
	reviewReport,
} from "../../examples/eumenes/evaluator.ts";

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
