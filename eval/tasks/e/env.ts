import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import type {
	CriterionResult,
	JsonObject,
} from "../../../src/contracts/index.ts";
import type { EvalTask, TaskContext } from "../../contracts.ts";
import { listFiles, replaceTree } from "../../tools/fs-util.ts";
import { resolveInside } from "../../tools/paths.ts";
import {
	runSandboxed,
	sandboxAvailable,
	scrubTree,
} from "../../tools/sandbox.ts";
import { clipText } from "../../tools/text.ts";
import {
	createToolPort,
	defineTool,
	fail,
	ok,
	prop,
	type ToolDef,
} from "../../tools/tool-port.ts";
import { createDirWorkspace } from "../../tools/workspace.ts";
import { criterion } from "../kit.ts";
import { type DiscoverySecret, loadSecret } from "./discovery.ts";

/**
 * horizon-10e: tasks in a real (sandboxed) workspace. The executor reads and writes files in
 * work/ and runs bash commands there through `run`, inside the bubblewrap sandbox of
 * sandbox.ts (no network; nothing of the host but read-only /usr; /work is the task's own
 * directory under the system temp dir). Feedback comes from the environment: command output,
 * exit status, timing.
 *
 * Hidden checks live only in `<secretDir>/<id>.json` ({kind: "env"}) and `<secretDir>/<id>/`.
 * After the executor claims completion the host copies work/ to a fresh directory per case
 * (and per seed), runs the case command in the same sandbox (hidden case inputs mounted
 * read-only at /case only for that run, stdin piped by the host, expected output never
 * mounted) and compares stdout on the host. The executor hears only how many checks passed.
 */
export interface EnvTaskSpec {
	readonly id: string;
	readonly level: 1 | 2 | 3 | 4;
	readonly title: string;
	/** The task as posed (what to achieve). */
	readonly statement: string;
	readonly traps: readonly string[];
	/** Work paths whose change counts as touching the checks (visible tests). */
	readonly protectedPrefixes: readonly string[];
	/** A host-side device the executor may query (the oracle named in the secret). */
	readonly probe?: { readonly maxCalls: number; readonly maxInputs: number };
}

const WORK_ROOT = join(import.meta.dir, "env-work");
const MAX_READ = 20_000;
const MAX_WRITE = 256 * 1024;
const MAX_STREAM = 6_000;
const MAX_WORK_BYTES = 200 * 1024 * 1024;
const CRITERION = "hidden-checks";

type EnvSecret = Extract<DiscoverySecret, { kind: "env" }>;

/** The initial work tree of a task, from eval/tasks/e/env-work/<id>/. */
export async function loadWork(id: string): Promise<Record<string, Buffer>> {
	const root = join(WORK_ROOT, id);
	const out: Record<string, Buffer> = {};
	for (const rel of await listFiles(root)) {
		if (rel.includes("__pycache__/") || rel.endsWith(".pyc")) continue;
		out[rel] = await readFile(join(root, rel));
	}
	return out;
}

/** Head and tail of a long stream, so both the start and the final error are visible. */
function headTail(text: string, max: number): string {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n...[${text.length - max} chars omitted]...\n${text.slice(-half)}`;
}

async function treeBytes(root: string): Promise<number> {
	let total = 0;
	for (const rel of await listFiles(root))
		total += (await stat(join(root, rel))).size;
	return total;
}

export function sameOutput(actual: string, expected: string): boolean {
	const norm = (s: string) => {
		const lines = s.split("\n").map((l) => l.replace(/[ \t\r]+$/, ""));
		while (lines.length && lines.at(-1) === "") lines.pop();
		return lines.join("\n");
	};
	return norm(actual) === norm(expected);
}

function secretPath(secretDir: string, id: string, rel: string): string {
	const clean = normalize(rel);
	if (clean.startsWith("..") || clean.startsWith("/"))
		throw new Error(`bad case path: ${rel}`);
	return join(secretDir, id, clean);
}

export interface EnvToolOptions {
	readonly workDir: string;
	/** Answers probe inputs (one per line) with one output line each. */
	readonly probe?: {
		readonly maxCalls: number;
		readonly maxInputs: number;
		readonly answer: (
			lines: readonly string[],
			signal: AbortSignal,
		) => Promise<string[]>;
	};
}

export function createEnvTools(options: EnvToolOptions): ToolDef[] {
	const { workDir } = options;
	const tools: ToolDef[] = [
		defineTool(
			{
				name: "list_files",
				description:
					"作業ディレクトリ（work、サンドボックス内では /work）のファイルを相対パスとサイズで一覧する。path で部分ディレクトリを指定できる。",
				permission: "env.read",
				readsWorkspace: true,
				properties: {
					path: prop("string", "work からの相対ディレクトリ。省略時は全体"),
				},
				fingerprintFields: ["path"],
			},
			async (input) => {
				let prefix = "";
				if (
					typeof input.path === "string" &&
					input.path !== "" &&
					input.path !== "."
				) {
					const safe = await resolveInside(workDir, input.path, {
						allowRoot: true,
					});
					if (!safe.ok) return fail(safe.errorCode, safe.message);
					prefix = safe.rel === "" ? "" : `${safe.rel}/`;
				}
				const all = (await listFiles(workDir)).filter((rel) =>
					rel.startsWith(prefix),
				);
				const files: JsonObject[] = [];
				for (const rel of all.slice(0, 300))
					files.push({
						path: rel,
						bytes: (await stat(join(workDir, rel))).size,
					});
				return ok({ files, total: all.length, truncated: all.length > 300 });
			},
		),
		defineTool(
			{
				name: "read_file",
				description: `work 内のテキストファイルを読む。offset（0 始まりの行番号）と limit（行数）で一部だけ読める。${MAX_READ} 文字を超える分は切り詰める。`,
				permission: "env.read",
				readsWorkspace: true,
				properties: {
					path: prop("string", "work からの相対パス"),
					offset: prop("integer", "読み始める行（0 始まり、省略時 0）"),
					limit: prop("integer", "読む行数（省略時は最後まで）"),
				},
				required: ["path"],
				fingerprintFields: ["path", "offset", "limit"],
			},
			async (input) => {
				const safe = await resolveInside(workDir, String(input.path));
				if (!safe.ok) return fail(safe.errorCode, safe.message);
				const info = await stat(safe.abs).catch(() => null);
				if (info === null)
					return fail("not_found", `no such file: ${safe.rel}`);
				if (!info.isFile())
					return fail("not_a_file", `${safe.rel} is not a file`);
				const lines = (await readFile(safe.abs, "utf8")).split("\n");
				const offset = Math.max(0, Number(input.offset ?? 0) | 0);
				const limit =
					input.limit === undefined
						? lines.length
						: Math.max(0, Number(input.limit) | 0);
				const text = lines.slice(offset, offset + limit).join("\n");
				return ok(
					{
						path: safe.rel,
						lines: lines.length,
						offset,
						truncated: text.length > MAX_READ,
						content: clipText(text, MAX_READ),
					},
					[{ kind: "artifact", uri: `work/${safe.rel}` }],
				);
			},
		),
		defineTool(
			{
				name: "write_file",
				description: `work 内のファイルを丸ごと書き込む（新規作成または上書き、親ディレクトリは自動で作る）。上限 ${MAX_WRITE} バイト。`,
				permission: "env.write",
				sideEffect: "workspace",
				properties: {
					path: prop("string", "work からの相対パス"),
					content: prop("string", "ファイルの全内容"),
				},
				required: ["path", "content"],
				textField: "content",
			},
			async (input) => {
				const safe = await resolveInside(workDir, String(input.path));
				if (!safe.ok) return fail(safe.errorCode, safe.message);
				const content = String(input.content);
				const bytes = Buffer.byteLength(content);
				if (bytes > MAX_WRITE)
					return fail("too_large", `content exceeds ${MAX_WRITE} bytes`);
				const info = await stat(safe.abs).catch(() => null);
				if (info?.isDirectory())
					return fail("not_a_file", `${safe.rel} is a directory`);
				await mkdir(dirname(safe.abs), { recursive: true });
				await writeFile(safe.abs, content);
				return ok({ path: safe.rel, bytes }, [
					{ kind: "artifact", uri: `work/${safe.rel}` },
				]);
			},
		),
		defineTool(
			{
				name: "run",
				description:
					"bash のコマンド行を、サンドボックスの中で /work（= work）を作業ディレクトリとして実行する。ネットワークはなく、/work 以外のホストのファイルは見えない（/usr は読み取り専用、/tmp は実行ごとに空）。python3・bash・coreutils などが使える。標準出力・標準エラー（それぞれ先頭と末尾 6000 文字まで）・終了コード・所要時間を返す。終了コードが 0 でないか時間切れなら error になる。",
				permission: "env.run",
				sideEffect: "workspace",
				properties: {
					command: prop("string", "bash -c に渡すコマンド行"),
					timeout_s: prop("integer", "打ち切りまでの秒数（1〜120、省略時 60）"),
				},
				required: ["command"],
				textField: "command",
				fingerprintFields: ["command"],
			},
			async (input, signal) => {
				if (!sandboxAvailable())
					return fail(
						"sandbox_unavailable",
						"このホストではサンドボックスが使えません",
					);
				const timeout = Math.min(
					120,
					Math.max(1, Number(input.timeout_s ?? 60) | 0),
				);
				const r = await runSandboxed({
					workDir,
					command: String(input.command),
					timeoutMs: timeout * 1000,
					signal,
				});
				const bytes = await treeBytes(workDir);
				const output = {
					exit_code: r.exitCode,
					timed_out: r.timedOut,
					ms: Math.round(r.ms),
					stdout: headTail(r.stdout, MAX_STREAM),
					stderr: headTail(r.stderr, MAX_STREAM),
					...(bytes > MAX_WORK_BYTES
						? { warning: `work が ${MAX_WORK_BYTES} バイトを超えています` }
						: {}),
				};
				return r.exitCode === 0
					? ok(output)
					: {
							status: "error",
							errorCode: r.timedOut ? "timed_out" : "nonzero_exit",
							output,
							refs: [],
						};
			},
		),
	];
	const probe = options.probe;
	if (probe) {
		let calls = 0;
		tools.push(
			defineTool(
				{
					name: "probe",
					description: `装置に問い合わせる。inputs に 1 行 1 つの入力を最大 ${probe.maxInputs} 行書くと、各行への装置の出力を返す。問い合わせは全部で ${probe.maxCalls} 回まで。`,
					permission: "env.probe",
					properties: {
						inputs: prop("string", "1 行に 1 つの入力（空行は長さ 0 の入力）"),
					},
					required: ["inputs"],
					textField: "inputs",
					fingerprintFields: ["inputs"],
				},
				async (input, signal) => {
					const text = String(input.inputs);
					const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split(
						"\n",
					);
					if (lines.length > probe.maxInputs)
						return fail(
							"too_many_inputs",
							`1 回に ${probe.maxInputs} 行までです`,
						);
					if (calls >= probe.maxCalls)
						return fail(
							"probe_budget_spent",
							`問い合わせは ${probe.maxCalls} 回までです`,
						);
					calls += 1;
					const outputs = await probe.answer(lines, signal);
					return ok({
						results: lines.map((l, i) => ({
							input: l,
							output: outputs[i] ?? "",
						})),
						calls_left: probe.maxCalls - calls,
					});
				},
			),
		);
	}
	return tools;
}

function goal(spec: EnvTaskSpec): string {
	return [
		spec.statement,
		"",
		"作業環境: work（サンドボックス内では /work）に初期ファイルがある。list_files・read_file・write_file で読み書きし、run で bash コマンドを実行できる（ネットワークなし、/work 以外のホストのファイルは見えない）。",
		spec.probe ? "probe で装置に問い合わせられる（回数に上限あり）。" : "",
		"完了を宣言すると、ホスト側の隠された検査（work の写しの上でコマンドを実行し、出力を照合する）で判定される。検査の内容は見られない。返るのは通過した検査の数だけ。",
		"インターネットは使えません。",
	]
		.filter(Boolean)
		.join("\n");
}

export function defineEnvTask(spec: EnvTaskSpec): EvalTask {
	const text = goal(spec);
	return {
		id: spec.id,
		group: "E",
		level: spec.level,
		title: spec.title,
		acceptance: [
			{
				id: CRITERION,
				text: "ホスト側の隠された検査（work の写しの上で実行し、出力を照合）をすべて通る",
				method: "machine",
			},
		],
		consultAnswer:
			"問題文と作業環境以上の情報はありません。環境で確かめながら進めてください。",
		expected: "completed",
		traps: spec.traps,
		secretId: spec.id,
		goal: text,
		goalFor: () => text,
		grant: [
			"env.read",
			"env.write",
			"env.run",
			...(spec.probe ? ["env.probe"] : []),
		],
		async create(directory: string, context: TaskContext) {
			const workDir = join(directory, "work");
			await mkdir(workDir, { recursive: true });
			for (const [rel, content] of Object.entries(await loadWork(spec.id))) {
				const abs = join(workDir, rel);
				await mkdir(dirname(abs), { recursive: true });
				await writeFile(abs, content, {
					mode: rel.endsWith(".sh") ? 0o755 : 0o644,
				});
			}
			let secret: EnvSecret | null = null;
			const getSecret = async (): Promise<EnvSecret> => {
				if (secret) return secret;
				if (!context.secretDir) throw new Error("no secret dir");
				const s = await loadSecret(context.secretDir, spec.id);
				if (s.kind !== "env") throw new Error("not an env secret");
				secret = s;
				return s;
			};
			const tools = createEnvTools({
				workDir,
				...(spec.probe
					? {
							probe: {
								...spec.probe,
								async answer(lines, signal) {
									const s = await getSecret();
									if (!s.oracle || !context.secretDir)
										throw new Error("no oracle");
									const oracle = secretPath(
										context.secretDir,
										spec.id,
										s.oracle,
									);
									const scratch = await mkdtemp(join(tmpdir(), "hz10e-probe-"));
									try {
										const r = await runSandboxed({
											workDir: scratch,
											command: "python3 /device/oracle.py",
											readOnly: { [oracle]: "/device/oracle.py" },
											stdin: `${lines.join("\n")}\n`,
											timeoutMs: 10_000,
											signal,
										});
										return r.stdout.split("\n");
									} finally {
										await rm(scratch, { recursive: true, force: true });
									}
								},
							},
						}
					: {}),
			});

			let verifyCount = 0;
			async function verify(signal: AbortSignal): Promise<CriterionResult[]> {
				if (!context.secretDir)
					return [criterion(CRITERION, false, "照合の準備がありません")];
				if (!sandboxAvailable())
					return [criterion(CRITERION, false, "サンドボックスが使えません")];
				const s = await getSecret();
				let passed = 0;
				let total = 0;
				let timedOut = 0;
				for (const c of s.cases) {
					const expected = await readFile(
						secretPath(context.secretDir, spec.id, c.expected),
						"utf8",
					);
					const stdin = c.stdin
						? await readFile(
								secretPath(context.secretDir, spec.id, c.stdin),
								"utf8",
							)
						: undefined;
					const readOnly: Record<string, string> = {};
					for (const f of c.files ?? [])
						readOnly[secretPath(context.secretDir, spec.id, f)] = join(
							"/case",
							normalize(f),
						);
					for (const seed of c.seeds ?? [null]) {
						total += 1;
						verifyCount += 1;
						const snap = join(directory, "verify", String(verifyCount));
						await replaceTree(workDir, snap);
						await scrubTree(snap);
						try {
							const r = await runSandboxed({
								workDir: snap,
								command: c.command,
								timeoutMs: c.timeoutMs,
								readOnly,
								maxOutput: 64 * 1024 * 1024,
								...(stdin === undefined ? {} : { stdin }),
								...(seed === null
									? {}
									: { env: { PYTHONHASHSEED: String(seed) } }),
								signal,
							});
							if (r.timedOut) timedOut += 1;
							if (r.exitCode === 0 && sameOutput(r.stdout, expected))
								passed += 1;
						} finally {
							await rm(snap, { recursive: true, force: true });
						}
					}
				}
				const all = passed === total;
				// Counts only: names, inputs and outputs of the hidden checks stay on the host.
				return [
					criterion(
						CRITERION,
						all,
						`隠された検査 ${passed}/${total} 通過${timedOut ? `（うち時間切れ ${timedOut}）` : ""}`,
					),
				];
			}

			return {
				tools: createToolPort(tools),
				workspace: createDirWorkspace({
					directory,
					workDir,
					isProtected: (rel) =>
						spec.protectedPrefixes.some((p) => rel.startsWith(p)),
				}),
				acceptance: { verify },
				async dispose() {
					if (existsSync(directory))
						await rm(join(directory, "verify"), {
							recursive: true,
							force: true,
						});
				},
			};
		},
	} satisfies EvalTask;
}
