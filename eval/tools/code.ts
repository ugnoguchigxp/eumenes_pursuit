import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { JsonObject } from "../../src/contracts/index.ts";
import { listFiles, replaceTree } from "./fs-util.ts";
import { resolveInside } from "./paths.ts";
import { readCapped, runSandboxed, sandboxAvailable } from "./sandbox.ts";
import { clipText, stripAnsi } from "./text.ts";
import { defineTool, fail, ok, prop, type ToolDef } from "./tool-port.ts";

export const MAX_WRITE_BYTES = 64 * 1024;
export const TEST_TIMEOUT_MS = 20_000;
const MAX_READ_CHARS = 16_000;
const MAX_TEST_OUTPUT = 4_000;
const MAX_LISTED = 200;

export interface BunRun {
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly output: string;
	readonly stdout: string;
	readonly stderr: string;
}

const sandboxExec = "/usr/bin/sandbox-exec";

/**
 * macOS sandbox for agent-written code: no network, no reads under HOME (the
 * project, .env, credentials) except bun itself. All filesystem writes are
 * denied except within the run's own snapshot. The lexical filter is not a sandbox.
 */
function sandboxProfile(cwd: string, taskDirectory: string): string {
	const q = (p: string) => JSON.stringify(realpathSync(p));
	const home = homedir();
	const bun = join(home, ".bun");
	return [
		"(version 1)",
		"(allow default)",
		"(deny network*)",
		"(deny file-write*)",
		`(deny file-read-data (subpath ${q(home)}))`,
		existsSync(bun) ? `(allow file-read-data (subpath ${q(bun)}))` : "",
		`(deny file-read-data (subpath ${q(join(taskDirectory, "hidden"))}))`,
		`(deny file-read-data (subpath ${q(join(taskDirectory, "data"))}))`,
		`(deny file-write* (subpath ${q(taskDirectory)}))`,
		`(allow file-write* (subpath ${q(cwd)}))`,
	].join("");
}

/** Imports and globals that would let task code reach files, processes or the network. */
const forbiddenCode =
	/\b(process|Bun|Deno|require|globalThis|eval|Function|constructor|fetch|XMLHttpRequest|WebSocket|__proto__)\b|\bimport\s*\(/;

/** Null when the file may be written; otherwise the reason. Only relative imports (and bun:test in tests). */
export function forbiddenApi(rel: string, content: string): string | null {
	// Identifiers only: comments and quoted strings may mention anything.
	const code = content
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
		.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
	const hit = forbiddenCode.exec(code);
	if (hit) return `使えない API: ${hit[0]}`;
	for (const m of content.matchAll(
		/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g,
	)) {
		const spec = m[1] ?? m[2] ?? "";
		if (spec.startsWith("./") || spec.startsWith("../")) continue;
		if (spec === "bun:test" && rel.startsWith("test/")) continue;
		return `import できないモジュール: ${spec}`;
	}
	return null;
}

/** Runs Bun tests in an OS sandbox; refuses execution if isolation is unavailable. */
export async function runIsolatedBun(
	cwd: string,
	args: readonly string[],
	signal?: AbortSignal,
	taskDirectory?: string,
	stdin?: string,
): Promise<BunRun> {
	if (!taskDirectory) throw new Error("sandbox_workspace_required");
	const inside = await resolveInside(
		taskDirectory,
		relative(resolve(taskDirectory), resolve(cwd)),
	);
	if (!inside.ok) throw new Error("sandbox_workspace_invalid");
	if (process.platform === "linux" && sandboxAvailable()) {
		const run = await runSandboxed({
			workDir: inside.abs,
			command: `/runtime/bun ${args.map((a) => "'" + a.replaceAll("'", "'\\''") + "'").join(" ")}`,
			...(stdin === undefined ? {} : { stdin }),
			readOnly: { [realpathSync(process.execPath)]: "/runtime/bun" },
			timeoutMs: TEST_TIMEOUT_MS,
			...(signal === undefined ? {} : { signal }),
		});
		return {
			exitCode: run.exitCode,
			timedOut: run.timedOut,
			output: `${run.stdout}${run.stderr}`,
			stdout: run.stdout,
			stderr: run.stderr,
		};
	}
	if (process.platform !== "darwin" || !existsSync(sandboxExec))
		throw new Error("sandbox_unavailable");
	const env: Record<string, string> = {};
	for (const key of ["PATH", "HOME"]) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	const command = [
		sandboxExec,
		"-p",
		sandboxProfile(inside.abs, taskDirectory),
		process.execPath,
		...args,
	];
	const proc = Bun.spawn(command, {
		cwd,
		env,
		stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: TEST_TIMEOUT_MS,
		killSignal: "SIGKILL",
		...(signal === undefined ? {} : { signal }),
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readCapped(proc.stdout, 1_000_000),
		readCapped(proc.stderr, 1_000_000),
		proc.exited,
	]);
	const timedOut = proc.killed && proc.signalCode === "SIGKILL";
	return {
		exitCode: timedOut ? null : exitCode,
		timedOut,
		output: stripAnsi(`${stdout}${stderr}`),
		stdout,
		stderr,
	};
}

export function runBunTest(
	cwd: string,
	target: string,
	signal?: AbortSignal,
	taskDirectory?: string,
): Promise<BunRun> {
	return runIsolatedBun(cwd, ["test", target], signal, taskDirectory);
}

/** Copies `workDir` to a fresh snapshot so runs never leave files in work. */
export async function snapshotWork(
	workDir: string,
	snapshotDir: string,
): Promise<void> {
	await replaceTree(workDir, snapshotDir);
}

export function isWritablePath(rel: string): boolean {
	return /^(src|test)\/[A-Za-z0-9_./-]+\.ts$/.test(rel) && !rel.includes("//");
}

export interface CodeToolsOptions {
	readonly directory: string;
	readonly workDir: string;
}

export function createCodeTools(options: CodeToolsOptions): ToolDef[] {
	const { directory, workDir } = options;
	let runCounter = 0;

	const listFilesTool = defineTool(
		{
			name: "list_files",
			description:
				"作業ディレクトリ (work) 内のファイルを相対パスで一覧する。path で部分ディレクトリを指定できる。",
			permission: "code.read",
			readsWorkspace: true,
			properties: {
				path: prop("string", "work からの相対ディレクトリ。省略時は全体"),
			},
			fingerprintFields: ["path"],
		},
		async (input) => {
			let prefix = "";
			if (typeof input.path === "string") {
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
			for (const rel of all.slice(0, MAX_LISTED)) {
				files.push({ path: rel, bytes: (await stat(join(workDir, rel))).size });
			}
			return ok({
				files,
				truncated: all.length > MAX_LISTED,
				total: all.length,
			});
		},
	);

	const readFileTool = defineTool(
		{
			name: "read_file",
			description: `work 内のテキストファイルを読む。offset（0 始まりの行番号）と limit（行数）で一部だけ読める。${MAX_READ_CHARS} 文字を超える分は切り詰める。`,
			permission: "code.read",
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
			let info;
			try {
				info = await stat(safe.abs);
			} catch {
				return fail("not_found", `no such file: ${safe.rel}`);
			}
			if (!info.isFile())
				return fail("not_a_file", `${safe.rel} is not a file`);
			const lines = (await readFile(safe.abs)).toString("utf8").split("\n");
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
					truncated: text.length > MAX_READ_CHARS,
					content: clipText(text, MAX_READ_CHARS),
				},
				[{ kind: "artifact", uri: `work/${safe.rel}` }],
			);
		},
	);

	const writeFileTool = defineTool(
		{
			name: "write_file",
			description: `work 内のファイルを丸ごと書き込む（新規作成または上書き）。書き込めるのは src/ と test/ 配下の .ts ファイルのみ。上限 ${MAX_WRITE_BYTES} バイト。`,
			permission: "code.write",
			sideEffect: "workspace",
			properties: {
				path: prop("string", "work からの相対パス（例: src/foo.ts）"),
				content: prop("string", "ファイルの全内容"),
			},
			required: ["path", "content"],
			textField: "content",
		},
		async (input) => {
			const safe = await resolveInside(workDir, String(input.path));
			if (!safe.ok) return fail(safe.errorCode, safe.message);
			if (!isWritablePath(safe.rel)) {
				return fail(
					"path_not_writable",
					"only .ts files under src/ and test/ can be written",
				);
			}
			const content = String(input.content);
			const forbidden = forbiddenApi(safe.rel, content);
			if (forbidden) return fail("forbidden_api", forbidden);
			const bytes = Buffer.byteLength(content);
			if (bytes > MAX_WRITE_BYTES) {
				return fail("too_large", `content exceeds ${MAX_WRITE_BYTES} bytes`);
			}
			try {
				if ((await stat(safe.abs)).isDirectory()) {
					return fail("not_a_file", `${safe.rel} is a directory`);
				}
			} catch {
				// new file
			}
			await mkdir(dirname(safe.abs), { recursive: true });
			await writeFile(safe.abs, content);
			return ok({ path: safe.rel, bytes }, [
				{ kind: "artifact", uri: `work/${safe.rel}` },
			]);
		},
	);

	const runTestsTool = defineTool(
		{
			name: "run_tests",
			description: `work の test/ にある見えるテストを bun test で実行し、出力（${MAX_TEST_OUTPUT} 文字まで）を返す。実行は ${TEST_TIMEOUT_MS / 1000} 秒で打ち切る。`,
			permission: "code.test",
			readsWorkspace: true,
			fingerprintFields: [],
		},
		async (_input, signal) => {
			runCounter += 1;
			const snapshot = join(directory, "runs", `visible-${runCounter}`);
			await snapshotWork(workDir, snapshot);
			try {
				const run = await runBunTest(snapshot, "./test/", signal, directory);
				const real = realpathSync(snapshot);
				const output = clipText(
					run.output.split(real).join("<work>").split(snapshot).join("<work>"),
					MAX_TEST_OUTPUT,
				);
				const result = {
					passed: run.exitCode === 0,
					timed_out: run.timedOut,
					exit_code: run.exitCode,
					output,
				};
				// A failing test run is an error outcome, so predictions and failure rules see it.
				return run.exitCode === 0
					? ok(result)
					: {
							status: "error",
							errorCode: run.timedOut ? "tests_timed_out" : "tests_failed",
							output: result,
							refs: [],
						};
			} finally {
				await rm(snapshot, { recursive: true, force: true });
			}
		},
	);

	return [listFilesTool, readFileTool, writeFileTool, runTestsTool];
}
