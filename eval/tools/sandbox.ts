import { existsSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { chmod, lstat, mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "./text.ts";

/**
 * Linux sandbox for agent-run commands (horizon-10e): bubblewrap with every namespace unshared
 * (no network, own pid/ipc/uts/user), read-only /usr (with /usr/local masked), a private /tmp,
 * the task's work directory at /work as the only writable host path, an empty environment, and
 * rlimits (address space, file size, open files, CPU time). Nothing else of the host is mounted,
 * so the project, the private author directory, the responders' directories and credentials
 * are not visible. Without bwrap the tools refuse to run (never unsandboxed).
 */
export const BWRAP = "/usr/bin/bwrap";
export const PRLIMIT = "/usr/bin/prlimit";

export function sandboxAvailable(): boolean {
	return existsSync(BWRAP) && existsSync(PRLIMIT);
}

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
let macPython: { prefix: string; bin: string } | null | undefined;
/**
 * The base interpreter behind the host's python3, so a virtualenv's packages stay
 * out, with a directory that offers it under the names python3 and python.
 */
function macPythonHome() {
	if (macPython !== undefined) return macPython;
	const host = Bun.which("python3");
	const found = host
		? Bun.spawnSync([
				host,
				"-c",
				"import os, sys; print(sys.base_prefix); print(os.path.realpath(sys._base_executable))",
			])
		: null;
	const [prefix, executable] =
		found?.exitCode === 0 ? found.stdout.toString().trim().split("\n") : [];
	if (!prefix || !executable || !existsSync(executable))
		return (macPython = null);
	const bin = mkdtempSync(join(tmpdir(), "sandbox-python-"));
	for (const name of ["python3", "python"])
		symlinkSync(executable, join(bin, name));
	return (macPython = { prefix: realpathSync(prefix), bin });
}

/** Commands can be isolated here: bubblewrap on Linux, sandbox-exec on macOS. */
export function commandSandboxAvailable(): boolean {
	return process.platform === "darwin"
		? existsSync(SANDBOX_EXEC) && macPythonHome() !== null
		: sandboxAvailable();
}

/**
 * macOS: no namespaces, so the command runs in the real work directory under a
 * sandbox-exec profile. No network; file contents are readable only in the work
 * directory, a private temporary directory, the Python installation and public
 * system paths; writes only in the first two. Read-only mounts are not supported.
 */
function macCommand(options: SandboxOptions, scratch: string): string[] {
	const q = (path: string) => JSON.stringify(realpathSync(path));
	const python = macPythonHome()!;
	const readable = [
		"/System/Library",
		"/Library/Apple/System/Library",
		"/usr/lib",
		"/usr/share",
		"/usr/bin",
		"/bin",
		"/private/etc",
		"/private/var/db/timezone",
		"/opt/homebrew/Cellar",
		"/opt/homebrew/opt",
		"/opt/homebrew/lib",
	].filter((path) => existsSync(path));
	const profile = [
		"(version 1)",
		"(allow default)",
		"(deny network*)",
		"(deny file-write*)",
		"(deny file-read-data)",
		...[options.workDir, scratch, python.prefix, python.bin].map(
			(path) =>
				`(allow file-read-data (subpath ${q(path)}) (path-ancestors ${q(path)}))`,
		),
		...readable.map(
			(path) => `(allow file-read-data (subpath ${JSON.stringify(path)}))`,
		),
		'(allow file-read-data (literal "/") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
		existsSync("/System/Library/Sandbox/Profiles/dyld-support.sb")
			? '(import "dyld-support.sb")'
			: "",
		`(allow file-write* (subpath ${q(options.workDir)}) (subpath ${q(scratch)}) (literal "/dev/null"))`,
	].join("");
	const limits = `ulimit -t ${Math.ceil(options.timeoutMs / 1000) + 5}; ulimit -f 131072; ulimit -n 512; `;
	// Its own process group, so a timeout can stop every process the command started.
	return [
		SANDBOX_EXEC,
		"-p",
		profile,
		"/usr/bin/perl",
		"-e",
		"setpgrp(0, 0); exec @ARGV",
		"/bin/bash",
		"-c",
		limits + options.command,
	];
}

export interface SandboxRun {
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly stdout: string;
	readonly stderr: string;
	readonly ms: number;
}

export interface SandboxOptions {
	/** Host directory mounted read-write at /work (the command's cwd). */
	readonly workDir: string;
	/** bash command line, run as `bash -c`. */
	readonly command: string;
	readonly timeoutMs: number;
	/** Extra host paths mounted read-only: host path → sandbox path. */
	readonly readOnly?: Readonly<Record<string, string>>;
	readonly stdin?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
	/** Bytes kept per stream. */
	readonly maxOutput?: number;
	/** Preserve program stdout for an exact output comparison. */
	readonly rawStdout?: boolean;
}

export function bwrapArgs(options: SandboxOptions): string[] {
	const env = {
		PATH: "/usr/bin:/bin",
		HOME: "/work",
		LANG: "C.UTF-8",
		...options.env,
	};
	return [
		PRLIMIT,
		"--as=4294967296",
		"--fsize=67108864",
		"--nofile=512",
		`--cpu=${Math.ceil(options.timeoutMs / 1000) + 5}`,
		"--",
		BWRAP,
		"--ro-bind",
		"/usr",
		"/usr",
		"--tmpfs",
		"/usr/local",
		"--symlink",
		"usr/bin",
		"/bin",
		"--symlink",
		"usr/lib",
		"/lib",
		"--symlink",
		"usr/lib64",
		"/lib64",
		"--symlink",
		"usr/sbin",
		"/sbin",
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--tmpfs",
		"/tmp",
		"--bind",
		options.workDir,
		"/work",
		...Object.entries(options.readOnly ?? {}).flatMap(([from, to]) => [
			"--ro-bind",
			from,
			to,
		]),
		"--chdir",
		"/work",
		"--unshare-all",
		"--hostname",
		"sandbox",
		"--die-with-parent",
		"--new-session",
		"--cap-drop",
		"ALL",
		"--clearenv",
		...Object.entries(env).flatMap(([k, v]) => ["--setenv", k, v]),
		"/usr/bin/bash",
		"-c",
		options.command,
	];
}

export async function readCapped(
	stream: ReadableStream<Uint8Array>,
	max: number,
): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (size < max) chunks.push(value.subarray(0, max - size));
		size += value.length;
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return size > max ? `${text}\n...[${size - max} more bytes]` : text;
}

export async function runSandboxed(
	options: SandboxOptions,
): Promise<SandboxRun> {
	if (!commandSandboxAvailable()) throw new Error("sandbox_unavailable");
	const mac = process.platform === "darwin";
	if (mac && Object.keys(options.readOnly ?? {}).length)
		throw new Error("sandbox_mount_unsupported");
	const scratch = mac ? await mkdtemp(join(tmpdir(), "sandbox-tmp-")) : null;
	try {
		return await execute(options, scratch);
	} finally {
		if (scratch) await rm(scratch, { recursive: true, force: true });
	}
}

async function execute(
	options: SandboxOptions,
	scratch: string | null,
): Promise<SandboxRun> {
	const started = performance.now();
	const max = options.maxOutput ?? 1_000_000;
	const proc = Bun.spawn(
		scratch ? macCommand(options, scratch) : bwrapArgs(options),
		{
			...(scratch
				? {
						cwd: options.workDir,
						env: {
							PATH: `${macPythonHome()!.bin}:/usr/bin:/bin`,
							HOME: options.workDir,
							TMPDIR: scratch,
							LANG: "C.UTF-8",
							...options.env,
						},
					}
				: { env: {} }),
			stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
			stdout: "pipe",
			stderr: "pipe",
			timeout: options.timeoutMs,
			killSignal: "SIGKILL",
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
	);
	const stopGroup = () => {
		try {
			process.kill(-proc.pid, "SIGKILL");
		} catch {
			// The group has already exited.
		}
	};
	const timer = scratch ? setTimeout(stopGroup, options.timeoutMs) : null;
	if (scratch) options.signal?.addEventListener("abort", stopGroup);
	const [stdout, stderr, exitCode] = await Promise.all([
		readCapped(proc.stdout, max),
		readCapped(proc.stderr, max),
		proc.exited,
	]).finally(() => {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener("abort", stopGroup);
		if (scratch) stopGroup();
	});
	const ms = performance.now() - started;
	const timedOut =
		proc.signalCode === "SIGKILL" && ms >= options.timeoutMs - 50;
	await scrubTree(options.workDir);
	return {
		exitCode: timedOut ? null : exitCode,
		timedOut,
		stdout: options.rawStdout ? stdout : stripAnsi(stdout),
		stderr: stripAnsi(stderr),
		ms,
	};
}

/**
 * After a sandboxed command: removes anything that is not a regular file or directory
 * (symlinks, fifos, sockets), so host-side copies and reads never follow a link out of the
 * work directory, and restores owner permissions so the host can copy and clean up.
 */
export async function scrubTree(root: string): Promise<void> {
	async function walk(dir: string): Promise<void> {
		await chmod(dir, 0o755).catch(() => {});
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			const info = await lstat(path).catch(() => null);
			if (info === null) continue;
			if (info.isDirectory()) await walk(path);
			else if (info.isFile())
				await chmod(path, (info.mode & 0o111) | 0o644).catch(() => {});
			else await unlink(path).catch(() => {});
		}
	}
	await walk(root);
}
