import { readAnswer, submitAnswerTool } from "../../tools/answer.ts";
import { clipText } from "../../tools/text.ts";
import { defineTool, fail, ok, prop } from "../../tools/tool-port.ts";
import type { EvalTask } from "../../contracts.ts";
import { criterion, defineTask } from "../kit.ts";

export type Candidate = {
	id: string;
	name: string;
	summary: Record<string, string | number>;
};

export type Doc = {
	id: string;
	candidateId: string;
	kind: string;
	title: string;
	text: string;
	/** Attribute keys this document states; hidden from the agent. */
	facts: readonly string[];
};

export interface ComparisonSpec {
	readonly id: string;
	readonly title: string;
	readonly goal: string;
	readonly traps: readonly string[];
	readonly candidates: readonly Candidate[];
	readonly docs: readonly Doc[];
	/** Candidates that satisfy every constraint. */
	readonly valid: readonly string[];
	/** Attribute keys the cited sources must jointly state. */
	readonly required: readonly string[];
	readonly acceptanceText: {
		readonly choice: string;
		readonly exist: string;
		readonly support: string;
	};
}

type StoredDoc = Omit<Doc, "facts" | "candidateId"> & { candidate_id: string };

const MAX_LIST = 25;
const MAX_HITS = 10;

export function defineComparisonTask(spec: ComparisonSpec): EvalTask {
	const documents: StoredDoc[] = spec.docs.map((d) => ({
		id: d.id,
		candidate_id: d.candidateId,
		kind: d.kind,
		title: d.title,
		text: d.text,
	}));
	const facts = Object.fromEntries(spec.docs.map((d) => [d.id, [...d.facts]]));
	return defineTask({
		id: spec.id,
		group: "C",
		title: spec.title,
		goal: spec.goal,
		acceptance: [
			{
				id: "choice-valid",
				text: spec.acceptanceText.choice,
				method: "machine",
			},
			{
				id: "sources-exist",
				text: spec.acceptanceText.exist,
				method: "machine",
			},
			{
				id: "sources-support",
				text: spec.acceptanceText.support,
				method: "machine",
			},
		],
		grant: ["data.read", "answer.write"],
		consultAnswer:
			"条件は本文のとおりです。それ以上の優先順位は特にありません。条件を満たすものを根拠つきで選んでください。",
		expected: "completed",
		traps: spec.traps,
		data: {
			"candidates.json": [...spec.candidates],
			"documents.json": documents,
		},
		hidden: {
			"solution.json": {
				valid: [...spec.valid],
				required: [...spec.required],
				facts,
			},
		},
		build(env) {
			const tools = [
				defineTool(
					{
						name: "list_candidates",
						description: `候補の一覧（id・名前・概要）を返す。1 回に最大 ${MAX_LIST} 件。概要は参考値であり、条件の根拠には文書を使うこと。`,
						permission: "data.read",
						properties: {
							offset: prop("integer", "開始位置（0 始まり）", { minimum: 0 }),
							limit: prop("integer", `件数（最大 ${MAX_LIST}）`, {
								minimum: 1,
								maximum: MAX_LIST,
							}),
						},
						fingerprintFields: ["offset", "limit"],
					},
					async (input) => {
						const all = await env.data<Candidate[]>("candidates.json");
						const offset = typeof input.offset === "number" ? input.offset : 0;
						const limit =
							typeof input.limit === "number" ? input.limit : MAX_LIST;
						const page = all.slice(offset, offset + limit);
						return ok({ total: all.length, offset, candidates: page });
					},
				),
				defineTool(
					{
						name: "get_candidate",
						description:
							"候補を id で 1 件取得し、その候補に紐づく文書の一覧（id・種別・題名）を返す。",
						permission: "data.read",
						properties: { id: prop("string", "候補の id") },
						required: ["id"],
					},
					async (input) => {
						const all = await env.data<Candidate[]>("candidates.json");
						const found = all.find((c) => c.id === input.id);
						if (found === undefined)
							return fail("not_found", `no candidate: ${String(input.id)}`);
						const docs = await env.data<StoredDoc[]>("documents.json");
						const own = docs.filter((d) => d.candidate_id === found.id);
						return ok({
							...found,
							documents: own.map((d) => ({
								id: d.id,
								kind: d.kind,
								title: d.title,
							})),
						});
					},
				),
				defineTool(
					{
						name: "read_document",
						description:
							"文書を id で読む。本文は 2000 文字を超える分を切り詰める。",
						permission: "data.read",
						properties: { id: prop("string", "文書の id") },
						required: ["id"],
						fingerprintFields: ["id"],
					},
					async (input) => {
						const docs = await env.data<StoredDoc[]>("documents.json");
						const doc = docs.find((d) => d.id === input.id);
						if (doc === undefined)
							return fail("not_found", `no document: ${String(input.id)}`);
						return ok(
							{
								id: doc.id,
								candidate_id: doc.candidate_id,
								kind: doc.kind,
								title: doc.title,
								text: clipText(doc.text, 2000),
							},
							[{ kind: "source", uri: `doc://${doc.id}` }],
						);
					},
				),
				defineTool(
					{
						name: "search_documents",
						description: `文書の題名と本文を語句で検索する（部分一致、大文字小文字は区別しない）。最大 ${MAX_HITS} 件を id・候補 id・題名で返す。`,
						permission: "data.read",
						properties: {
							query: prop("string", "検索語", { minLength: 1, maxLength: 100 }),
							kind: prop("string", "文書の種別で絞り込む"),
						},
						required: ["query"],
						fingerprintFields: ["query", "kind"],
					},
					async (input) => {
						const docs = await env.data<StoredDoc[]>("documents.json");
						const q = String(input.query).toLowerCase();
						const hits = docs.filter(
							(d) =>
								(input.kind === undefined || d.kind === input.kind) &&
								(d.title.toLowerCase().includes(q) ||
									d.text.toLowerCase().includes(q)),
						);
						return ok({
							total_hits: hits.length,
							truncated: hits.length > MAX_HITS,
							hits: hits.slice(0, MAX_HITS).map((d) => ({
								id: d.id,
								candidate_id: d.candidate_id,
								kind: d.kind,
								title: d.title,
							})),
						});
					},
				),
				submitAnswerTool({
					workDir: env.workDir,
					description:
						"選んだ候補と根拠の文書 id を work/answer.json に書き込む（上書き）。",
					properties: {
						choice: prop("string", "選んだ候補の id"),
						sources: {
							type: "array",
							description: "根拠にした文書の id",
							items: { type: "string" },
							maxItems: 12,
						},
					},
					required: ["choice", "sources"],
				}),
			];
			return {
				tools,
				async verify() {
					const answer = await readAnswer(env.workDir);
					if (answer.state !== "ok") {
						const why = `answer.json is ${answer.state}`;
						return ["choice-valid", "sources-exist", "sources-support"].map(
							(id) => criterion(id, false, why),
						);
					}
					const solution = await env.hidden<{
						valid: string[];
						required: string[];
						facts: Record<string, string[]>;
					}>("solution.json");
					const docs = await env.data<StoredDoc[]>("documents.json");
					const { choice, sources } = answer.value;
					const results = [];
					results.push(
						criterion(
							"choice-valid",
							typeof choice === "string" && solution.valid.includes(choice),
							`chose ${String(choice)}`,
						),
					);
					const cited =
						Array.isArray(sources) &&
						sources.every((s) => typeof s === "string")
							? (sources as string[])
							: null;
					const known = new Set(docs.map((d) => d.id));
					const missing =
						cited === null ? [] : cited.filter((s) => !known.has(s));
					results.push(
						criterion(
							"sources-exist",
							cited !== null && cited.length > 0 && missing.length === 0,
							cited === null
								? "sources is not a list of ids"
								: cited.length === 0
									? "no sources cited"
									: missing.length === 0
										? `${cited.length} sources exist`
										: `unknown ids: ${missing.join(",")}`,
						),
					);
					const own = new Set(
						docs.filter((d) => d.candidate_id === choice).map((d) => d.id),
					);
					const stated = new Set<string>();
					for (const id of cited ?? []) {
						if (own.has(id))
							for (const f of solution.facts[id] ?? []) stated.add(f);
					}
					const lacking = solution.required.filter((f) => !stated.has(f));
					results.push(
						criterion(
							"sources-support",
							lacking.length === 0 && own.size > 0,
							lacking.length === 0 && own.size > 0
								? "cited sources state every constrained attribute"
								: `cited sources of the chosen candidate do not state: ${lacking.join(",")}`,
						),
					);
					return results;
				},
			};
		},
	});
}
