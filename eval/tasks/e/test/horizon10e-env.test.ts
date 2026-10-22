import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxed, sandboxAvailable } from "../../../tools/sandbox.ts";
import { tasks } from "../../index.ts";
import { sameOutput } from "../env.ts";
import { horizon10eTasks } from "../horizon-env.ts";

const signal = AbortSignal.timeout(120_000);
const maybe = sandboxAvailable() ? test : test.skip;
const find = (id: string) => horizon10eTasks.find((t) => t.id === id)!;

/** Fixture checks only (trivial commands); the real hidden cases live outside the repository. */
function fixtureSecrets(
	id: string,
	cases: unknown[],
	extra: Record<string, string> = {},
	oracle?: string,
) {
	const secretDir = mkdtempSync(join(tmpdir(), "hz10e-secrets-"));
	mkdirSync(join(secretDir, id), { recursive: true });
	for (const [rel, text] of Object.entries(extra)) {
		mkdirSync(join(secretDir, id, rel, ".."), { recursive: true });
		writeFileSync(join(secretDir, id, rel), text);
	}
	writeFileSync(
		join(secretDir, `${id}.json`),
		JSON.stringify({ id, kind: "env", cases, ...(oracle ? { oracle } : {}) }),
	);
	return secretDir;
}

async function instance(id: string, secretDir: string) {
	const dir = mkdtempSync(join(tmpdir(), "hz10e-task-"));
	const inst = await find(id).create(dir, {
		grader: null,
		toolTier: 0,
		secretDir,
	});
	const invoke = (tool: string, input: Record<string, unknown>) =>
		inst.tools.invoke({ tool, input: input as never }, signal);
	return {
		dir,
		inst,
		invoke,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

describe("horizon-10e sandbox", () => {
	maybe(
		"no network, no host files beyond /usr, /usr/local masked, private /tmp",
		async () => {
			const work = mkdtempSync(join(tmpdir(), "hz10e-sbx-"));
			try {
				const r = await runSandboxed({
					workDir: work,
					command:
						"ls / | tr '\\n' ' '; echo; ls /usr/local | wc -l; test -e /workspace && echo WS; test -e /home && echo HOME; test -e /etc/passwd && echo ETC; python3 -c 'import socket; socket.create_connection((\"1.1.1.1\",80),timeout=2)' 2>/dev/null && echo NET; echo $HOME; env | wc -l",
					timeoutMs: 20_000,
				});
				expect(r.exitCode).toBe(0);
				const lines = r.stdout.trim().split("\n");
				expect(lines[0]!.trim().split(" ").sort()).toEqual([
					"bin",
					"dev",
					"lib",
					"lib64",
					"proc",
					"sbin",
					"tmp",
					"usr",
					"work",
				]);
				expect(lines[1]).toBe("0");
				expect(r.stdout).not.toMatch(/\b(WS|HOME|ETC|NET)\b/);
				expect(r.stdout).toContain("/work");
			} finally {
				rmSync(work, { recursive: true, force: true });
			}
		},
	);

	maybe(
		"symlinks and fifos made inside are removed afterwards; timeouts kill the command",
		async () => {
			const work = mkdtempSync(join(tmpdir(), "hz10e-sbx-"));
			try {
				await runSandboxed({
					workDir: work,
					command:
						"ln -s /etc/hostname link; mkfifo pipe; echo x > ok.txt; chmod 000 ok.txt",
					timeoutMs: 10_000,
				});
				expect(readdirSync(work)).toEqual(["ok.txt"]);
				const slow = await runSandboxed({
					workDir: work,
					command: "sleep 30 & sleep 30",
					timeoutMs: 1_000,
				});
				expect(slow.timedOut).toBe(true);
				expect(slow.exitCode).toBeNull();
			} finally {
				rmSync(work, { recursive: true, force: true });
			}
		},
	);

	test("output comparison ignores trailing spaces and blank lines only", () => {
		expect(sameOutput("a\t1 \nb\n\n", "a\t1\nb")).toBe(true);
		expect(sameOutput("b\na\n", "a\nb\n")).toBe(false);
	});
});

describe("horizon-10e tasks", () => {
	test("four tasks registered with secret ids, protected visible checks, expected completed", () => {
		expect(horizon10eTasks.map((t) => t.id)).toEqual([
			"hz10e-room-utilization",
			"hz10e-window-sums",
			"hz10e-black-box",
			"hz10e-sales-pipeline",
		]);
		for (const t of horizon10eTasks) {
			expect(tasks).toContain(t);
			expect(t.secretId).toBe(t.id);
			expect(t.expected).toBe("completed");
			expect(t.goalFor!(0)).toContain("隠された検査");
		}
	});

	maybe(
		"tools: run reports failures as errors, writes land in work, /case is not visible while working",
		async () => {
			const secretDir = fixtureSecrets(
				"hz10e-room-utilization",
				[{ name: "x", command: "true", expected: "x.out", timeoutMs: 5000 }],
				{ "x.out": "" },
			);
			const t = await instance("hz10e-room-utilization", secretDir);
			try {
				expect((await t.invoke("list_files", {})).status).toBe("ok");
				const tests = await t.invoke("run", {
					command: "python3 -m unittest discover -s tests -t . 2>&1 | tail -1",
				});
				expect(tests.status).toBe("ok");
				expect(JSON.stringify(tests.output)).toContain("OK");
				const failing = await t.invoke("run", { command: "ls /case; exit 3" });
				expect(failing.status).toBe("error");
				expect((failing as { errorCode?: string }).errorCode).toBe(
					"nonzero_exit",
				);
				expect(
					(await t.invoke("write_file", { path: "notes/a.txt", content: "hi" }))
						.status,
				).toBe("ok");
				const read = await t.invoke("run", { command: "cat notes/a.txt" });
				expect(JSON.stringify(read.output)).toContain("hi");
				expect(
					(await t.invoke("read_file", { path: "../../etc/passwd" })).status,
				).toBe("error");
			} finally {
				t.cleanup();
				rmSync(secretDir, { recursive: true, force: true });
			}
		},
	);

	maybe(
		"run: clipped streams come back whole in unclipped (fixes-2026-10-22-d §3.1); awk and sqlite3 are documented as absent (§3.7)",
		async () => {
			const secretDir = fixtureSecrets(
				"hz10e-room-utilization",
				[{ name: "x", command: "true", expected: "x.out", timeoutMs: 5000 }],
				{ "x.out": "" },
			);
			const t = await instance("hz10e-room-utilization", secretDir);
			try {
				const long = (await t.invoke("run", {
					command: "python3 -c \"print('a'*4000 + 'NEEDLE' + 'b'*4000)\"",
				})) as unknown as { output: { stdout: string }; unclipped?: string[] };
				expect(long.output.stdout).not.toContain("NEEDLE");
				expect(long.output.stdout).toContain("字を省略");
				expect(long.unclipped?.[0]).toContain("NEEDLE");
				const short = (await t.invoke("run", {
					command: "echo hi",
				})) as unknown as {
					unclipped?: string[];
				};
				expect(short.unclipped).toBeUndefined();
				const missing = await t.invoke("run", {
					command: "command -v awk || command -v sqlite3 || echo none",
				});
				expect(JSON.stringify(missing.output)).toContain("none");
				const run = t.inst.tools.list().find((d) => d.name === "run")!;
				expect(run.description).toContain("awk と sqlite3 コマンドは無い");
			} finally {
				t.cleanup();
				rmSync(secretDir, { recursive: true, force: true });
			}
		},
	);

	maybe(
		"verify runs each case per seed on a fresh copy, mounts case files read-only, reports counts only",
		async () => {
			const secretDir = fixtureSecrets(
				"hz10e-sales-pipeline",
				[
					{
						name: "seeded",
						command:
							"echo $PYTHONHASHSEED > /dev/null; cat /case/in.txt; touch /work/left-behind",
						files: ["in.txt"],
						expected: "same.out",
						timeoutMs: 5000,
						seeds: [1, 2, 3],
					},
					{
						name: "stdin",
						command: "tr a-z A-Z",
						stdin: "s.in",
						expected: "s.out",
						timeoutMs: 5000,
					},
					{
						name: "readonly",
						command: "echo no > /case/in.txt",
						files: ["in.txt"],
						expected: "empty.out",
						timeoutMs: 5000,
					},
				],
				{
					"in.txt": "hello\n",
					"same.out": "hello\n",
					"s.in": "abc\n",
					"s.out": "ABC\n",
					"empty.out": "",
				},
			);
			const t = await instance("hz10e-sales-pipeline", secretDir);
			try {
				const [c] = await t.inst.acceptance.verify(signal);
				expect(c!.passed).toBe(false);
				expect(c!.evidence).toBe("隠された検査 4/5 通過");
				expect(t.inst.diagnostics?.()).toEqual({
					hiddenPassed: 4,
					hiddenTotal: 5,
				});
				const files = await t.invoke("list_files", {});
				expect(JSON.stringify(files.output)).not.toContain("left-behind");
			} finally {
				t.cleanup();
				rmSync(secretDir, { recursive: true, force: true });
			}
		},
	);

	maybe(
		"probe answers from the host-side device with a call budget",
		async () => {
			const secretDir = fixtureSecrets(
				"hz10e-black-box",
				[{ name: "x", command: "true", expected: "x.out", timeoutMs: 5000 }],
				{
					"x.out": "",
					"dev.py":
						"import sys\nfor l in sys.stdin.read().split('\\n')[:-1]: print(len(l))\n",
				},
				"dev.py",
			);
			const t = await instance("hz10e-black-box", secretDir);
			try {
				const r = await t.invoke("probe", { inputs: "\nab\nabc" });
				expect(r.output).toMatchObject({
					results: [
						{ input: "", output: "0" },
						{ input: "ab", output: "2" },
						{ input: "abc", output: "3" },
					],
					calls_left: 39,
				});
				// fixes-2026-10-22-e §8: the full results are kept in work for re-reading.
				const log = await t.invoke("read_file", {
					path: "scratch/probe_log.jsonl",
				});
				expect(JSON.stringify(log.output)).toContain('\\"input\\":\\"abc\\"');
				const desc = t.inst.tools.list().find((d) => d.name === "probe")!;
				expect(desc.reread).toContain("scratch/probe_log.jsonl");
				expect(
					(await t.invoke("probe", { inputs: Array(26).fill("a").join("\n") }))
						.status,
				).toBe("error");
				for (let i = 0; i < 39; i++) await t.invoke("probe", { inputs: "a" });
				expect((await t.invoke("probe", { inputs: "a" })).status).toBe("error");
				const visible = await t.invoke("run", {
					command: "ls -R / 2>/dev/null | grep -cx dev.py || true",
				});
				expect(JSON.stringify(visible.output)).toContain('"stdout":"0');
			} finally {
				t.cleanup();
				rmSync(secretDir, { recursive: true, force: true });
			}
		},
	);

	maybe("changing a visible test counts as a protected touch", async () => {
		const secretDir = fixtureSecrets(
			"hz10e-window-sums",
			[{ name: "x", command: "true", expected: "x.out", timeoutMs: 5000 }],
			{ "x.out": "" },
		);
		const t = await instance("hz10e-window-sums", secretDir);
		try {
			const cp = await t.inst.workspace!.checkpoint();
			await t.invoke("run", {
				command: "echo '# x' >> tests/test_windowsum.py",
			});
			const changes = await t.inst.workspace!.changesSince(cp);
			expect(changes.protectedTouched).toEqual(["tests/test_windowsum.py"]);
		} finally {
			t.cleanup();
			rmSync(secretDir, { recursive: true, force: true });
		}
	});
});
