import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openExample } from "../../examples/eumenes/host.ts";
import { scripted } from "../../examples/eumenes/fixtures.ts";
import type { ResearchDraft } from "../../examples/eumenes/contracts.ts";

test("15 sources cover strategy renewal, reopening and full-body verification", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pursuit-long-research-"));
	const sourceCount = 15;
	const phaseSize = 5;
	const padding = "0123456789\n".repeat(1100);
	const sources = Array.from({ length: sourceCount }, (_, i) => {
		const observation = `区画 ${i + 1} の点検結果は ${i % 7} 件。`;
		return {
			url: `https://fixture.example/section-${i + 1}`,
			title: `区画 ${i + 1}`,
			text: i === sourceCount - 1 ? padding + observation : observation,
			observation,
			fetchedAt: 0,
			truncated: false,
		};
	});
	const longSource = sources.at(-1)!;
	const events: Record<string, unknown>[] = [];
	const requested: string[] = [];
	let referencedArtifactInputs = 0;
	const base = scripted("museum");
	const action = (tool: string, input: object) => ({
		tool,
		inputJson: JSON.stringify(input),
		text: null,
		expectedStatus: "ok",
		expectedObservation: "指定した操作の結果を受領する",
		whatChanged: "点検資料または保存結果を確認する",
		refutedIf: "結果が欠けている",
	});
	const open = () =>
		openExample({
			directory,
			request: `${sources.length}区画の点検結果を出典と照合して保存してください。`,
			execution: "productive",
			limits: { modelCalls: 30, childCalls: sources.length, searches: 0 },
			log: (event) => events.push(event),
			async web(request) {
				const url = (request.arguments as { url: string }).url;
				requested.push(url);
				const { observation: _observation, ...doc } = sources.find(
					(source) => source.url === url,
				)!;
				return { state: "finished", hits: [], documents: [doc], failures: [] };
			},
			generator: {
				async complete(request, signal) {
					const response = await base.complete(request, signal);
					if (request.purpose === "grade") {
						const { report, evidence, markdownSave } = JSON.parse(
							JSON.parse(request.prompt).state,
						) as {
							report: ResearchDraft;
							evidence: {
								evidence: string;
								url: string;
								excerpts: { start: number; text: string; clipped: boolean }[];
							}[];
							markdownSave: { bytes: number };
						};
						expect(markdownSave.bytes).toBe(Buffer.byteLength(report.answer));
						expect(evidence).toHaveLength(sources.length);
						for (const source of sources) {
							const citation = evidence.find((e) => e.url === source.url)!;
							expect(citation.excerpts).toEqual([
								{ start: 0, text: source.text, clipped: false },
							]);
							expect(report.answer).toContain(
								source.observation + " " + source.url,
							);
							expect(
								report.claims.some((c) =>
									c.evidence.includes(citation.evidence),
								),
							).toBe(true);
						}
						return {
							...response,
							value: request.schema.parse({
								passed: true,
								evidence: `${sources.length}区画を照合`,
							}),
						};
					}
					if (request.purpose !== "propose") return response;
					const packet = JSON.parse(request.prompt) as {
						state: string;
						sources: { url: string; evidence: string }[];
					};
					const snapshot = JSON.parse(packet.state.split("\n\n").at(-1)!);
					for (const attempt of snapshot.attempts) {
						if (attempt.inputIn !== "artifacts") continue;
						const artifact = snapshot.artifacts.find(
							(item: { seq: number }) => item.seq === attempt.seq,
						);
						expect(attempt.input).toBeUndefined();
						expect(JSON.parse(artifact.input).claims.length).toBeGreaterThan(0);
						referencedArtifactInputs++;
					}
					const choice = response.value as {
						progress: { kind: string; evidence: number[] };
					};
					const count = packet.sources.length;
					const remaining = sources.filter(
						(s) => !packet.sources.some((source) => source.url === s.url),
					);
					const reread = snapshot.attempts.some(
						(a: { tool: string; state: string }) =>
							a.tool === "source_read" && a.state === "settled",
					);
					const complete = remaining.length === 0 && reread;
					const renew = count > 0;
					const renewStrategy =
						renew && snapshot.remainingHypothesisRenewals === 0;
					const draft = {
						completion: complete ? "complete" : "incomplete",
						title: `${sources.length}区画の点検結果`,
						answer: packet.sources
							.map((source) => {
								const original = sources.find((s) => s.url === source.url)!;
								return original.observation + " " + original.url;
							})
							.join("\n"),
						summary: `${count}区画を照合`,
						claims: Array.from({ length: Math.ceil(count / 5) }, (_, i) => ({
							text: "点検結果と出典を照合した",
							status: "verified",
							evidence: packet.sources
								.slice(i * 5, i * 5 + 5)
								.map((s) => s.evidence),
						})),
						limitations: complete ? [] : ["未取得の区画あり"],
						stopReason: complete ? "全区画を照合" : "確認済みの区画を保存",
					};
					// Two groups of five each use four hypotheses. The first pair
					// exercises parallel reads, while the next three use one each.
					const batchSize =
						count >= phaseSize * 2
							? phaseSize
							: count % phaseSize === 0
								? 2
								: 1;
					const actions = remaining
						.slice(0, batchSize)
						.map((s) => action("web_read", { url: s.url }));
					if (!remaining.length && !reread)
						actions.push(
							action("source_read", {
								evidence: packet.sources.find(
									(source) => source.url === longSource.url,
								)!.evidence,
								start: padding.length,
								limit: longSource.observation.length,
							}),
						);
					if (renewStrategy || complete)
						actions.unshift(action("report_draft", draft));
					if (complete) actions.push(action("report_read", {}));
					return {
						...response,
						value: request.schema.parse({
							...choice,
							choice: complete ? "complete" : "act",
							actions,
							sequence: complete,
							waitAfterDispatch: !complete,
							renewHypothesis: renew
								? {
										body: `${count}区画まで取得済み。次の区画または完成報告を照合する`,
										expected: "今回の資料と報告を照合できる",
										targets: [],
									}
								: null,
							renewStrategy: renewStrategy
								? {
										body: "確認済みの結果を保存して作業を更新する",
										rationale: "仮説数の上限に到達",
										parts: ["保存", "照合"],
										alternatives: [],
									}
								: null,
						}),
					};
				},
			},
		});
	let host = await open();
	const stopAfterSave = (completion: string) => () =>
		events.some((e) => e.kind === "tool_adopted" && e.job === "markdown") &&
		host.snapshot().state.draft?.completion === completion;
	try {
		const id = host.coreId;
		const first = await host.drive(undefined, stopAfterSave("incomplete"));
		expect(first.paused).toBe(true);
		expect(requested).toHaveLength(phaseSize);
		await host.close();
		host = await open();
		expect(host.coreId).toBe(id);
		const second = await host.drive(undefined, stopAfterSave("complete"));
		expect(second.paused).toBe(true);
		expect(requested).toHaveLength(sources.length);
		expect(second.view.verifications).toHaveLength(0);
		await host.close();
		host = await open();
		const { view, markdown } = await host.drive();
		expect(host.coreId).toBe(id);
		expect(view.status).toBe("completed");
		expect(view.report?.verified).toBe(true);
		expect(referencedArtifactInputs).toBeGreaterThan(0);
		const input = events.find((e) => e.kind === "acceptance_input")!;
		expect(input.draftDigest).toMatch(/^[a-f0-9]{64}$/);
		const finalSave = view.attempts
			.filter((a) => a.tool === "report_draft")
			.at(-1)!;
		expect(input.markdownSave).toMatchObject({ attempt: finalSave.seq });
		expect(input.sources).toHaveLength(sources.length);
		expect(events.find((e) => e.kind === "acceptance_result")).toMatchObject({
			inputDigest: input.inputDigest,
			passed: true,
			unavailable: false,
		});
		expect(view.strategies).toHaveLength(3);
		expect([...requested].sort()).toEqual(sources.map((s) => s.url).sort());
		const longFetch = view.attempts.find(
			(a) => a.tool === "web_read" && a.input.url === longSource.url,
		)!;
		expect(longFetch.observation?.output).toMatchObject({
			documents: [{ url: longSource.url, truncated: true }],
		});
		expect(JSON.stringify(longFetch.observation?.output)).not.toContain(
			longSource.observation,
		);
		const longRead = view.attempts.find((a) => a.tool === "source_read")!;
		expect(longRead.observation?.output).toMatchObject({
			start: padding.length,
			text: longSource.observation,
		});
		expect(view.attempts.filter((a) => a.tool === "report_read")).toHaveLength(
			1,
		);
		expect(view.verifications.map((v) => v.trigger)).toEqual([
			"claim",
			"final",
		]);
		expect(view.attempts.filter((a) => a.tool === "report_draft")).toHaveLength(
			3,
		);
		expect(await readFile(markdown!, "utf8")).toBe(
			host.snapshot().state.draft!.answer,
		);
		for (const [index, save] of events.entries()) {
			if (save.kind !== "tool_adopted" || save.job !== "markdown") continue;
			const attempt = view.attempts.find((a) => a.id === save.attemptId)!;
			if (attempt.input.completion !== "incomplete") continue;
			const next = view.attempts.find((a) => a.seq === attempt.seq + 1)!;
			const receipt = events.find(
				(e) => e.kind === "tool_adopted" && e.attemptId === next.id,
			)!;
			expect(next.tool).toBe("web_read");
			expect(
				events.findIndex(
					(e) => e.kind === "job_started" && e.id === receipt.id,
				),
			).toBeGreaterThan(index);
		}
		const bytes = events
			.filter((e) => e.kind === "model_started" && e.purpose === "propose")
			.map((e) => Number(e.inputBytes));
		if (process.env.PURSUIT_MEASURE_FIXTURE)
			console.log(
				JSON.stringify({
					requests: bytes.length,
					total: bytes.reduce((a, b) => a + b, 0),
					max: Math.max(...bytes),
				}),
			);
	} finally {
		await host.close();
		await rm(directory, { recursive: true, force: true });
	}
});
