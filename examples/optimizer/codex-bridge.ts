import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LlmOutputError, type LlmPort } from "../../src/index.ts";

export const codexModel = "gpt-6-luna";
const requestSchema = z.strictObject({
	system: z.string(),
	prompt: z.string(),
	schema: z.record(z.string(), z.unknown()),
});
type Request = z.infer<typeof requestSchema>;
const turnMetrics = z.strictObject({
	input: z.int().nonnegative(),
	cached: z.int().nonnegative(),
	output: z.int().nonnegative(),
	searches: z.int().nonnegative(),
	latencyMs: z.number().nonnegative(),
});
const responseSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(false),
		error: z.string(),
		metrics: turnMetrics.optional(),
	}),
	z.strictObject({
		ok: z.literal(true),
		value: z.unknown(),
		metrics: turnMetrics,
	}),
]);

async function publish(path: string, value: unknown) {
	const pending = path + ".tmp";
	await writeFile(pending, JSON.stringify(value), { flag: "wx" });
	await rename(pending, path);
}

export function codexBridge(directory: string) {
	const usage = { calls: 0, input: 0, cached: 0, output: 0, searches: 0 };
	const model: LlmPort = {
		async complete(request, signal) {
			signal.throwIfAborted();
			const deadline = AbortSignal.any([signal, AbortSignal.timeout(130000)]);
			const id = crypto.randomUUID();
			const path = join(directory, id);
			const schema = z.toJSONSchema(request.schema, { target: "draft-7" });
			delete schema.$schema;
			usage.calls++;
			await publish(path + ".request.json", {
				system:
					request.system +
					(usage.calls === 1
						? "\n初回は一般に公開された関連技術をWeb検索で1回調べてから応答する。非公開の課題文・コード・入力は検索語に含めない。"
						: ""),
				prompt: request.prompt,
				schema,
			});
			try {
				while (!(await Bun.file(path + ".response.json").exists())) {
					deadline.throwIfAborted();
					await Bun.sleep(150);
				}
				const response = responseSchema.parse(
					await Bun.file(path + ".response.json").json(),
				);
				const metrics = response.metrics;
				if (metrics) {
					usage.input += metrics.input;
					usage.cached += metrics.cached;
					usage.output += metrics.output;
					usage.searches += metrics.searches;
				}
				if (!response.ok) throw new Error(response.error);
				const parsed = request.schema.safeParse(response.value);
				if (!parsed.success) throw new LlmOutputError("schema", codexModel);
				return {
					value: parsed.data,
					model: codexModel,
					inputTokens: response.metrics.input - response.metrics.cached,
					cacheReadTokens: response.metrics.cached,
					outputTokens: response.metrics.output,
					latencyMs: response.metrics.latencyMs,
				};
			} finally {
				if (deadline.aborted) await writeFile(path + ".cancel", "");
			}
		},
	};
	return { model, usage };
}

const disallowed = new Set([
	"command_execution",
	"file_change",
	"mcp_tool_call",
]);
const eventSchema = z.looseObject({
	type: z.string(),
	item: z
		.looseObject({
			id: z.string(),
			type: z.string(),
			text: z.string().optional(),
			server: z.string().optional(),
			tool: z.string().optional(),
		})
		.optional(),
	usage: z
		.looseObject({
			input_tokens: z.int().nonnegative(),
			cached_input_tokens: z.int().nonnegative(),
			output_tokens: z.int().nonnegative(),
		})
		.optional(),
});

async function runCodex(
	request: Request,
	path: string,
	apiKey: string,
	parent: AbortSignal,
) {
	const root = await mkdtemp(join(tmpdir(), "optimizer-codex-turn-"));
	const started = performance.now();
	try {
		const state = join(root, "state"),
			work = join(root, "work");
		await Promise.all([
			mkdir(state),
			mkdir(work),
			writeFile(join(root, "schema.json"), JSON.stringify(request.schema)),
		]);
		const signal = AbortSignal.any([parent, AbortSignal.timeout(120000)]);
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key, value]) =>
					value !== undefined &&
					[
						"PATH",
						"HOME",
						"TMPDIR",
						"LANG",
						"LC_ALL",
						"SSL_CERT_FILE",
						"SSL_CERT_DIR",
						"NODE_EXTRA_CA_CERTS",
					].includes(key),
			),
		) as Record<string, string>;
		const processHandle = Bun.spawn(
			[
				"codex",
				"-a",
				"never",
				"exec",
				"--ephemeral",
				"--ignore-user-config",
				"--ignore-rules",
				"--skip-git-repo-check",
				"--sandbox",
				"read-only",
				"--json",
				"-C",
				work,
				"-m",
				codexModel,
				"-c",
				'model_reasoning_effort="medium"',
				"-c",
				'web_search="live"',
				"-c",
				"mcp_servers={}",
				"-c",
				"developer_instructions=" +
					JSON.stringify(
						request.system +
							"\nこのCodexセッションで呼べる内蔵道具はWeb検索です。問題文に示された実証ランナーの道具はこのセッションから実行できません。必要な操作を、指定された応答スキーマの提案として返してください。計画や仮説の応答では要求された項目を返してください。",
					),
				...[
					"shell_tool",
					"apps",
					"plugins",
					"remote_plugin",
					"multi_agent",
					"multi_agent_v2",
					"browser_use",
					"browser_use_external",
					"in_app_browser",
					"computer_use",
					"skill_search",
					"skill_mcp_dependency_install",
					"tool_suggest",
				].flatMap((name) => ["--disable", name]),
				"--output-schema",
				join(root, "schema.json"),
				"-",
			],
			{
				env: { ...env, CODEX_HOME: state, CODEX_API_KEY: apiKey },
				stdin: new Blob([request.prompt]),
				stdout: "pipe",
				stderr: "pipe",
				signal,
			},
		);
		const watch = setInterval(() => {
			void Bun.file(path + ".cancel")
				.exists()
				.then((cancelled) => {
					if (cancelled) processHandle.kill();
				});
		}, 250);
		let raw: string, errorText: string, exit: number;
		try {
			[raw, errorText, exit] = await Promise.all([
				new Response(processHandle.stdout).text(),
				new Response(processHandle.stderr).text(),
				processHandle.exited,
			]);
		} finally {
			clearInterval(watch);
		}
		const events = raw
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => eventSchema.parse(JSON.parse(line)));
		const last = events
			.filter(
				(event) =>
					event.type === "item.completed" &&
					event.item?.type === "agent_message",
			)
			.at(-1)?.item?.text;
		const usage = events.find(
			(event) => event.type === "turn.completed",
		)?.usage;
		const searches = new Set(
			events
				.filter(
					(event) =>
						event.type === "item.completed" &&
						event.item?.type === "web_search",
				)
				.map((event) => event.item?.id),
		).size;
		await writeFile(
			path + ".trace.json",
			JSON.stringify({
				exit,
				usage,
				searches,
				eventTypes: events.map((event) => [
					event.type,
					event.item?.type,
					event.item?.server,
					event.item?.tool,
				]),
				...(!usage
					? {
							error: errorText
								.split("\n")
								.filter((line) => /error|not supported/i.test(line))
								.slice(-3)
								.join("\n")
								.replaceAll(apiKey, "[redacted]"),
						}
					: {}),
			}),
		);
		const metrics = usage && {
			input: usage.input_tokens,
			cached: usage.cached_input_tokens,
			output: usage.output_tokens,
			searches,
			latencyMs: performance.now() - started,
		};
		if (
			exit !== 0 ||
			events.some((event) => event.item && disallowed.has(event.item.type)) ||
			!last ||
			!metrics
		)
			return {
				ok: false as const,
				error: "codex_turn_invalid",
				...(metrics ? { metrics } : {}),
			};
		return { ok: true as const, value: JSON.parse(last), metrics };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export async function serveCodex(directory: string, signal: AbortSignal) {
	const key = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY;
	if (!key) throw new Error("OpenAI API credential missing");
	await mkdir(directory, { recursive: true });
	while (!signal.aborted) {
		const file = (await readdir(directory)).find((name) =>
			/^[0-9a-f-]{36}\.request\.json$/.test(name),
		);
		if (!file) {
			await Bun.sleep(150);
			continue;
		}
		const path = join(directory, file.slice(0, -".request.json".length));
		await rename(join(directory, file), path + ".running.json");
		try {
			const request = requestSchema.parse(
				JSON.parse(await readFile(path + ".running.json", "utf8")),
			);
			await publish(
				path + ".response.json",
				await runCodex(request, path, key, signal),
			);
		} catch (error) {
			await publish(path + ".response.json", {
				ok: false,
				error:
					error instanceof Error
						? error.name + ": " + error.message.replaceAll(key, "[redacted]")
						: "codex_bridge_failed",
			});
		}
	}
}

if (import.meta.main) {
	const directory = process.argv[2];
	if (!directory)
		throw new Error(
			"usage: bun examples/optimizer/codex-bridge.ts <bridge directory>",
		);
	const stop = new AbortController();
	process.on("SIGINT", () => stop.abort());
	process.on("SIGTERM", () => stop.abort());
	await serveCodex(directory, stop.signal);
}
