import type { LlmPort } from "../../src/index.ts";
import type { WebRequest } from "./context.ts";
import type { ResearchDraft } from "./contracts.ts";
import type { EvaluationModel } from "./evaluator.ts";
import { delay, type WebResult } from "./host.ts";

type Source = { url: string; title: string; text: string };
const source = (key: string, title: string, text: string): Source => ({
	url: `https://fixture.example/${key}`,
	title,
	text,
});
const a = source(
	"a",
	"施設A 常設展示 利用規則",
	"常設展示は撮影可。禁止表示を優先。フラッシュ、三脚、自撮り棒は使用不可。企画展は個別規則。",
);
const b = source(
	"b",
	"施設B 常設展示 来館案内",
	"常設展示の撮影は個人利用に限り可。禁止表示を優先。フラッシュ、三脚は使用不可。自撮り棒の記載はない。特別展は個別規則。",
);
const c = source(
	"c",
	"施設B 常設展示 旧版Q&A",
	"2024年版（失効済み）。施設Bの常設展示では三脚の使用可。現行規則は別ページを参照。",
);
const indexed = source(
	"indexed",
	"IndexedDB test reference",
	"IndexedDB uses asynchronous operations and transactions and stores structured-clone values including objects and blobs. Quotas and eviction depend on the browser; storage is not backup.",
);
const storage = source(
	"storage",
	"Web Storage test reference",
	"Web Storage uses synchronous operations with string keys and values. localStorage persists across sessions, sessionStorage is scoped to a page session. Storage may be cleared or evicted; it is not backup.",
);
const common =
	"指定した資料の取得本文で根拠を確認し、主張と出典リンクの対応を示してください。確認できない事項や資料の限界を明記してください。fixture.exampleはこの検証用の資料であり、実在する情報は使わないでください。";
const museum =
	"施設Aと施設Bの常設展示の撮影可否、禁止表示、フラッシュ、三脚、自撮り棒、特別展の扱いを比較してください。資料に記載がない項目は不明と明記すればよく、外部の追加資料は不要です。";
export const cases = [
	"technical",
	"museum",
	"denied",
	"missing",
	"conflict",
	"cap",
] as const;
export type Case = (typeof cases)[number];

export const scriptedEvaluator: EvaluationModel = {
	async complete({ prompt }, signal) {
		signal.throwIfAborted();
		const { scope } = JSON.parse(prompt) as { scope: string[] };
		return {
			model: "fixture",
			text: JSON.stringify({
				findings: [],
				scopeChecks: scope.map((evidenceId) => ({
					evidenceId,
					status: "checked",
					reason: null,
				})),
				conditionChecks: [],
			}),
		};
	},
};

export function fixture(
	name: Case,
	latency = { lookup: 120, read: 120, stagger: 80 },
) {
	const sources =
		name === "technical"
			? [indexed, storage]
			: name === "conflict"
				? [a, b, c]
				: [a, b];
	const request =
		(name === "technical"
			? "IndexedDBとWeb Storageの同期性、データ型、保存期間・消去、オフライン用途の違いを比較してください。"
			: museum) +
		(name === "conflict"
			? "施設Bの三脚について現行案内と旧版の矛盾を両方確認し、版と適用範囲を区別してください。"
			: "") +
		(name === "missing"
			? "施設Bの現行案内の本文確認は必須です。別資料で代用しないでください。"
			: "") +
		(name === "cap"
			? "施設Aと施設Bの両方の本文確認は必須です。どちらも確認できない場合は、確認済みの事項を残して未完了としてください。"
			: "") +
		"\n" +
		common +
		"\n対象資料: " +
		sources.map((s) => s.title + " " + s.url).join("、");
	const limits = {
		modelCalls: 80,
		childCalls: name === "cap" ? 1 : 24,
		searches: 8,
	};
	async function web(
		request: WebRequest,
		signal: AbortSignal,
	): Promise<WebResult> {
		const { url } = request.arguments as { url?: string };
		await delay(
			request.kind === "lookup"
				? latency.lookup
				: latency.read +
						(sources.indexOf(sources.find((s) => s.url === url)!) === 0
							? latency.stagger
							: 0),
			signal,
		);
		const empty = { hits: [], documents: [], failures: [] };
		if (request.kind === "lookup") {
			if (name === "denied")
				return { ...empty, state: "failed", code: "guard_denied" };
			return {
				...empty,
				state: "finished",
				hits: sources.map((s, i) => ({
					url: s.url,
					title: s.title,
					snippet: "検証用の候補です。本文を取得して確認してください。",
					provider: "fixture",
					rank: i + 1,
					trust: "untrusted",
					tainted: true,
					verification: "search_summary",
				})),
			};
		}
		const doc = sources.find((s) => s.url === url);
		if (!doc || (name === "missing" && doc.url === b.url))
			return {
				...empty,
				state: "failed",
				code: "fetch_unavailable",
				failures: url
					? [{ url, code: "fetch_unavailable", retryable: false }]
					: [],
			};
		return {
			...empty,
			state: "finished",
			documents: [
				{ ...doc, fetchedAt: Date.UTC(2026, 10, 8), truncated: false },
			],
		};
	}
	return {
		request,
		limits,
		sources,
		web,
		expectedComplete: name !== "missing" && name !== "cap",
	};
}

interface Packet {
	state: string;
	sources: { evidence: string; url: string; title: string }[];
	report: ResearchDraft | null;
}
const action = (
	tool: string,
	input: object,
	expectedStatus: "ok" | "error" = "ok",
) => ({
	tool,
	inputJson: JSON.stringify(input),
	text: null,
	expectedStatus,
	expectedObservation: "対象と結果を結びつけた記録が返る",
	whatChanged: "",
	refutedIf: "期待する対象または結果が記録にない",
});

/** Repeatable driver for boundary tests. Real model evaluation uses the same host/fixtures. */
export function scripted(
	name: Case,
	options: { think?: boolean; latencyMs?: number; repeat?: boolean } = {},
): LlmPort {
	const f = fixture(name);
	let step = 0,
		thought = false;
	const draft = (packet: Packet): ResearchDraft & { title: string } => {
		const claims: ResearchDraft["claims"] = f.sources.map((s) => {
			const evidence = packet.sources.find((d) => d.url === s.url)?.evidence;
			return {
				text: evidence ? s.text : s.title + "は未確認",
				status: evidence ? "verified" : "unknown",
				evidence: evidence ? [evidence] : [],
			};
		});
		const complete =
			f.expectedComplete && claims.every((c) => c.status === "verified");
		return {
			title: "資料比較",
			completion: complete ? "complete" : "incomplete",
			answer: f.sources
				.map(
					(s, i) =>
						`## ${s.title}\n${claims[i]!.text}\n${claims[i]!.status === "verified" ? `[出典](${s.url})` : "本文未確認"}`,
				)
				.join("\n\n"),
			summary: complete ? "比較を完了" : "未確認の資料がある",
			claims,
			limitations: complete ? [] : ["取得できない本文は未確認"],
			stopReason: complete ? "条件を照合した" : "必須の資料が不足",
		};
	};
	return {
		async complete(request, signal) {
			const started = performance.now();
			if (options.latencyMs) await delay(options.latencyMs, signal);
			const packet = JSON.parse(request.prompt) as Packet;
			let value: unknown;
			if (request.purpose === "plan")
				value = {
					strategy: "指定本文を照合して比較する",
					rationale: "出典の確認が必要",
					alternatives: [],
					parts: ["本文の確認", "比較の保存"],
				};
			else if (request.purpose === "hypothesize")
				value = {
					hypothesis: "指定資料に比較条件がある",
					rationale: "本文を直接取得して確認する",
					tools: [
						"web_lookup",
						"web_read",
						"source_read",
						"report_draft",
						"report_read",
					],
					targets: ["report.json"],
					expected: "本文と比較の対応が確認できる",
				};
			else if (request.purpose === "grade") {
				const grading = JSON.parse(packet.state) as {
					report: ResearchDraft;
					evidence: {
						evidence: string;
						url: string;
						excerpts: { text: string }[];
					}[];
				};
				const passed =
					f.expectedComplete &&
					grading.report.completion === "complete" &&
					f.sources.every((s) => {
						const evidence = grading.evidence.find(
							(d) =>
								d.url === s.url &&
								d.excerpts.some((x) => x.text.includes(s.text)),
						);
						return (
							!!evidence &&
							grading.report.claims.some(
								(c) =>
									c.evidence.includes(evidence.evidence) &&
									c.status === "verified" &&
									c.text === s.text,
							) &&
							grading.report.answer.includes(s.url) &&
							grading.report.answer.includes(s.text)
						);
					});
				value = {
					passed,
					evidence: passed
						? "指定資料の本文、主張、リンクを照合"
						: "必須資料または主張の裏付けが不足",
				};
			} else if (request.purpose === "review")
				value = {
					decision: "stop",
					reason: "固定試験の終了判断",
					brokenAssumption: "追加資料なし",
					direction: "未確認を明記",
				};
			else {
				const props = request.schema.toJSONSchema().properties as Record<
					string,
					unknown
				>;
				if ("basis" in props) {
					const status = JSON.parse(packet.state.split("\n\n").at(-1)!) as {
						basis: string;
						newlyUnassessed: number[];
						pending: { tool: string }[];
						attempts: {
							seq: number;
							tool: string;
							state: string;
							error?: string;
							rejection?: unknown[];
						}[];
						priorConclusions: string[];
					};
					const recent = status.attempts.filter((a) =>
						status.newlyUnassessed.includes(a.seq),
					);
					const first = status.attempts.length === 0;
					const kind = first
						? "initial"
						: recent.some((a) => a.error || a.state === "rejected")
							? "constraint"
							: recent.some((a) => a.tool === "report_draft")
								? "artifact"
								: recent.some((a) => a.tool === "web_read")
									? "evidence"
									: "none";
					const base = {
						basis: status.basis,
						progress: {
							assessed: status.newlyUnassessed,
							kind,
							change: "今回の受領内容を確認",
							criteria: ["answer"],
							evidence: recent
								.filter((a) => a.state === "settled")
								.map((a) => a.seq),
							conclusions: [] as string[],
						},
						choice: "act",
						reason: "固定試験の次の作業",
						missing: "",
						contribution: "依頼に必要な本文と保存を確認",
						route: kind === "none" ? "alternative" : "advance",
						actions: [] as ReturnType<typeof action>[],
						sequence: false,
						cancelPending: false,
						renewHypothesis: null,
						renewStrategy: null,
					};
					if (first) {
						base.actions = f.sources.map((s) =>
							action(
								"web_read",
								{ url: s.url },
								name === "missing" && s.url === b.url ? "error" : "ok",
							),
						);
						if (name === "cap") base.actions = base.actions.slice(0, 2);
					} else if (status.pending.length) {
						if (options.think && !thought) {
							base.choice = "think";
							base.progress = {
								...base.progress,
								kind: "reasoning",
								change: "比較表の列と適用範囲を決定",
								conclusions: ["常設と特別展を別行にし、版の違いを明記する。"],
							};
							thought = true;
						} else base.choice = "wait";
					} else if (options.repeat) {
						base.progress.kind = "none";
						base.route = "alternative";
						base.actions = [action("web_read", { url: f.sources.at(-1)!.url })];
					} else {
						base.choice =
							f.expectedComplete && packet.sources.length === f.sources.length
								? "complete"
								: "partial";
						base.actions = [
							action("report_draft", draft(packet)),
							action("report_read", {}),
						];
						base.sequence = true;
					}
					value = base;
				} else {
					const index = step++;
					const reads = f.sources.map((s) =>
						action(
							"web_read",
							{ url: s.url },
							name === "missing" && s.url === b.url ? "error" : "ok",
						),
					);
					const chosen = [
						...reads,
						action("report_draft", draft(packet)),
						action("report_read", {}),
					][index];
					value = {
						kind: chosen ? "tool" : f.expectedComplete ? "done" : "give_up",
						tool: chosen?.tool ?? null,
						inputJson: chosen?.inputJson ?? null,
						text: null,
						expectedStatus: chosen?.expectedStatus ?? null,
						expectedObservation: chosen?.expectedObservation ?? null,
						refutedIf: chosen?.refutedIf ?? null,
						whatChanged: "",
						message: "固定試験の報告",
						missing: "",
						following: [],
						findings: [],
						refute: [],
						uses: [],
						assessment: [
							{ part: 1, status: "done", evidence: "本文取得", next: "" },
						],
						acceptanceCheck: [
							{ id: "citations", met: true, where: "report.json" },
							{ id: "answer", met: true, where: "report.json" },
						],
					};
				}
			}
			return {
				value: request.schema.parse(value),
				model: "fixture",
				inputTokens: null,
				outputTokens: null,
				cacheReadTokens: null,
				latencyMs: performance.now() - started,
			};
		},
	};
}
