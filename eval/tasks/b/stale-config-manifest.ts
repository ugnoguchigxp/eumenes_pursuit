import { readAnswer, submitAnswerTool } from "../../tools/answer.ts";
import { defineTool, fail, ok, prop } from "../../tools/tool-port.ts";
import { criterion, defineTask } from "../kit.ts";

type Manifest = {
	release_id: string;
	service: string;
	deployed_at: string;
	base_config: { request_timeout_ms: number; max_retries: number };
	env_overrides: Record<
		string,
		{ request_timeout_ms?: number; max_retries?: number }
	>;
};

const manifests: Manifest[] = [
	{
		release_id: "rel-2026-09-18-1",
		service: "billing-api",
		deployed_at: "2026-09-18T03:10:00Z",
		base_config: { request_timeout_ms: 5000, max_retries: 3 },
		env_overrides: {
			prod: { request_timeout_ms: 6000 },
			staging: { request_timeout_ms: 4000 },
		},
	},
	{
		release_id: "rel-2026-10-02-2",
		service: "billing-api",
		deployed_at: "2026-10-02T05:42:00Z",
		base_config: { request_timeout_ms: 5000, max_retries: 3 },
		env_overrides: {
			prod: { request_timeout_ms: 8000, max_retries: 2 },
			staging: { request_timeout_ms: 4000 },
		},
	},
	{
		release_id: "rel-2026-10-09-1",
		service: "billing-api",
		deployed_at: "2026-10-09T06:00:00Z",
		base_config: { request_timeout_ms: 5000, max_retries: 3 },
		env_overrides: {
			prod: { request_timeout_ms: 9000 },
			staging: { request_timeout_ms: 7000 },
		},
	},
];

const deployed: Record<string, Record<string, string>> = {
	"billing-api": { prod: "rel-2026-10-02-2", staging: "rel-2026-10-09-1" },
};

export const staleConfigManifest = defineTask({
	id: "b-stale-config-manifest",
	group: "B",
	title: "遅延したレプリカの設定値ではなくデプロイ済みの値を確かめる",
	goal: "サービス billing-api の本番（prod）環境で現在有効な request_timeout_ms を調べ、answer.json に timeout_ms（整数、ミリ秒）として提出してください。",
	acceptance: [
		{
			id: "timeout-value",
			text: "answer.json の timeout_ms が、billing-api の本番環境に現在デプロイされているリリースで有効な request_timeout_ms と一致していること。",
			method: "machine",
		},
	],
	grant: ["data.read", "answer.write"],
	consultAnswer:
		"設定サービスの遅延の原因は私にも分かりません。他に確かめる手段があればそれで進めてください。",
	expected: "completed",
	traps: [
		"get_live_config は stale: true の古い値（3000）を返す",
		"staging の現行リリースや prod の前のリリースの値が見える",
		"リリースの値は base_config ではなく env_overrides.prod にある",
	],
	data: { "manifests.json": manifests, "deployed.json": deployed },
	hidden: { "expected.json": { timeout_ms: 8000 } },
	build(env) {
		const envProp = prop("string", "環境", { enum: ["prod", "staging"] });
		const tools = [
			defineTool(
				{
					name: "get_live_config",
					description:
						"設定サービスのレプリカから、サービスと環境の現在の設定を取得する。",
					permission: "data.read",
					properties: { service: prop("string", "サービス名"), env: envProp },
					required: ["service", "env"],
					fingerprintFields: ["service", "env"],
				},
				async (input) => {
					if (input.service !== "billing-api")
						return fail("not_found", `no service: ${String(input.service)}`);
					return ok({
						service: "billing-api",
						env: String(input.env),
						config: { request_timeout_ms: 3000, max_retries: 3 },
						stale: true,
						as_of: "2026-03-14T00:00:00Z",
						note: "レプリカの同期が止まっており、最新のデプロイを反映していない可能性がある。",
					});
				},
			),
			defineTool(
				{
					name: "get_current_release",
					description:
						"サービスの指定環境に現在デプロイされているリリース id を返す。",
					permission: "data.read",
					properties: { service: prop("string", "サービス名"), env: envProp },
					required: ["service", "env"],
					fingerprintFields: ["service", "env"],
				},
				async (input) => {
					const all = await env.data<typeof deployed>("deployed.json");
					const id = all[String(input.service)]?.[String(input.env)];
					if (id === undefined) return fail("not_found", "no such service/env");
					return ok({
						service: String(input.service),
						env: String(input.env),
						release_id: id,
					});
				},
			),
			defineTool(
				{
					name: "get_release_manifest",
					description:
						"リリースのマニフェストを返す。共通の設定 (base_config) と環境ごとの上書き (env_overrides) を含む。環境ごとの上書きがあれば、その環境ではそちらが有効になる。",
					permission: "data.read",
					properties: { release_id: prop("string", "リリース id") },
					required: ["release_id"],
					fingerprintFields: ["release_id"],
				},
				async (input) => {
					const all = await env.data<Manifest[]>("manifests.json");
					const manifest = all.find((m) => m.release_id === input.release_id);
					if (manifest === undefined)
						return fail("not_found", `no release: ${String(input.release_id)}`);
					return ok({ ...manifest }, [
						{ kind: "source", uri: `release://${manifest.release_id}` },
					]);
				},
			),
			submitAnswerTool({
				workDir: env.workDir,
				description: "回答を work/answer.json に書き込む（上書き）。",
				properties: {
					timeout_ms: prop("integer", "request_timeout_ms（ミリ秒）", {
						minimum: 0,
					}),
				},
				required: ["timeout_ms"],
			}),
		];
		return {
			tools,
			async verify() {
				const answer = await readAnswer(env.workDir);
				if (answer.state !== "ok")
					return [
						criterion("timeout-value", false, `answer.json is ${answer.state}`),
					];
				const expected = await env.hidden<{ timeout_ms: number }>(
					"expected.json",
				);
				return [
					criterion(
						"timeout-value",
						answer.value.timeout_ms === expected.timeout_ms,
						`expected ${expected.timeout_ms}; answered ${String(answer.value.timeout_ms)}`,
					),
				];
			},
		};
	},
});
