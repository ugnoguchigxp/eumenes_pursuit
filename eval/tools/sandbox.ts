import { existsSync } from "node:fs";
import { chmod, lstat, readdir, unlink } from "node:fs/promises";
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

async function readCapped(
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
	if (!sandboxAvailable()) throw new Error("sandbox_unavailable");
	const started = performance.now();
	const max = options.maxOutput ?? 1_000_000;
	const proc = Bun.spawn(bwrapArgs(options), {
		env: {},
		stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: options.timeoutMs,
		killSignal: "SIGKILL",
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readCapped(proc.stdout, max),
		readCapped(proc.stderr, max),
		proc.exited,
	]);
	const ms = performance.now() - started;
	const timedOut =
		proc.signalCode === "SIGKILL" && ms >= options.timeoutMs - 50;
	await scrubTree(options.workDir);
	return {
		exitCode: timedOut ? null : exitCode,
		timedOut,
		stdout: stripAnsi(stdout),
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
