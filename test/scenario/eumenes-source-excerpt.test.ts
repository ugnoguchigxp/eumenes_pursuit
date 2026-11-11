import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, scripted } from "../../examples/eumenes/fixtures.ts";
import { hash } from "../../examples/eumenes/hash.ts";
import { openExample } from "../../examples/eumenes/host.ts";

test.each([true, false])(
	"source ranges opt-in %s preserves the full result for acceptance",
	async (sourceRanges) => {
		const directory = await mkdtemp(join(tmpdir(), "pursuit-excerpt-"));
		const research = fixture("museum", { lookup: 1, read: 1, stagger: 1 });
		const base = scripted("museum");
		const target = research.sources[0]!;
		const fullText = target.text + "\n" + "補足資料\n".repeat(16000);
		let requested = false;
		let compared = false;
		const host = await openExample({
			directory,
			request: research.request,
			execution: "productive",
			...(sourceRanges ? { sourceRanges: true } : {}),
			async web(request, signal) {
				const response = await research.web(request, signal);
				return {
					...response,
					documents: response.documents.map((doc) =>
						doc.url === target.url
							? { ...doc, text: fullText, truncated: true }
							: doc,
					),
				};
			},
			generator: {
				async complete(request, signal) {
					const result = await base.complete(request, signal);
					if (request.purpose !== "propose") return result;
					const outer = JSON.parse(request.prompt);
					const state = JSON.parse(outer.state.split("\n\n").at(-1));
					const choice = result.value as { choice: string };
					if (!requested && choice.choice === "complete") {
						requested = true;
						const id = outer.sources.find(
							(doc: { url: string }) => doc.url === target.url,
						).evidence;
						const make = (tool: string, input: object) => ({
							tool,
							inputJson: JSON.stringify({ evidence: id, ...input }),
							text: null,
							expectedStatus: "ok",
							expectedObservation: "本文の範囲",
							whatChanged: "取得済み本文の位置を確認",
							refutedIf: "取得した本文を確認できない",
						});
						return {
							...result,
							value: request.schema.parse({
								...choice,
								choice: "act",
								sequence: false,
								actions: [
									make("source_find", { text: "存在しない検索語" }),
									make("source_read", { start: 0, limit: 12000 }),
									make("source_read", { start: 500, limit: 12000 }),
								],
							}),
						};
					}
					if (requested && choice.choice === "complete" && !compared) {
						const results = state.attempts.filter(
							(a: { tool: string }) =>
								a.tool === "source_read" || a.tool === "source_find",
						);
						expect(results).toHaveLength(3);
						expect(
							request.system.includes("its shownRange is the visible portion"),
						).toBe(sourceRanges);
						if (sourceRanges) {
							expect(results[0].observation.source).toMatchObject({
								matchIndex: null,
								returnedRange: null,
								shownRange: null,
							});
							for (const [i, limit] of [1800, 8000].entries()) {
								const shown = results[i + 1].observation;
								const start = i * 500;
								expect(shown.source).toMatchObject({
									version: hash(fullText),
									sourceTruncated: true,
									returnedRange: { start, end: start + 12000 },
									shownRange: { start, end: start + shown.text.length },
								});
								expect(JSON.stringify(shown).length).toBeLessThanOrEqual(limit);
								expect(shown.text).toBe(
									fullText.slice(start, start + shown.text.length),
								);
							}
						} else {
							expect(
								results.map(
									(a: { observation: unknown }) => typeof a.observation,
								),
							).toEqual(["string", "string", "string"]);
						}
						compared = true;
						return {
							...result,
							value: request.schema.parse({
								...choice,
								renewHypothesis: {
									body: "確認済み資料を成果として保存する",
									expected: "保存・読戻しを確認",
									targets: [],
								},
							}),
						};
					}
					return result;
				},
			},
		});
		try {
			const { view } = await host.drive();
			expect(compared).toBe(true);
			expect(view.status).toBe("completed");
			expect(view.report?.verified).toBe(true);
			const latest = view.attempts
				.filter((a) => a.tool === "source_read")
				.at(-1)!;
			expect(latest.observation?.output).toMatchObject({
				text: fullText.slice(500, 12500),
			});
			expect(latest.observation?.sourceExcerpt?.version).toBe(
				sourceRanges ? hash(fullText) : undefined,
			);
		} finally {
			await host.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
