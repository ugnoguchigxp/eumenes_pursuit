import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createCodeTools, forbiddenApi, runBunTest } from "../code.ts";
import { sandboxAvailable } from "../sandbox.ts";
import { createToolPort } from "../tool-port.ts";

const available =
	(process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) ||
	(process.platform === "linux" && sandboxAvailable());

describe("code execution isolation", () => {
	test.skipIf(!available)(
		"accepted code cannot read home, write outside work or use the network",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "code-isolation-"));
			const homeDir = await mkdtemp(join(homedir(), ".pursuit-isolation-"));
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: () => new Response("network fixture"),
			});
			try {
				expect(await (await fetch(server.url)).text()).toBe("network fixture");
				const task = join(dir, "task");
				const work = join(task, "work");
				for (const path of ["work/test", "hidden", "data"])
					await mkdir(join(task, path), { recursive: true });
				const outside = join(dir, "outside.txt");
				const privateFile = join(homeDir, "private.txt");
				await writeFile(privateFile, "private fixture");
				// Computed property access deliberately bypasses the lexical filter. OS permissions must hold.
				const content = `const runtime = (() => {})["con" + "structor"]("return Bun")();
export async function probe() {
  const result = { inside: false, outside: false, home: false, network: false };
  await runtime.write("inside.txt", "allowed"); result.inside = true;
  try { await runtime.write(${JSON.stringify(outside)}, "forbidden"); result.outside = true; } catch {}
  try { await runtime.file(${JSON.stringify(privateFile)}).text(); result.home = true; } catch {}
  try { await (0, (() => {})["con" + "structor"]("return fetch")())(${JSON.stringify(server.url.href)}, {signal: AbortSignal.timeout(500)}); result.network = true; } catch {}
  return result;
}`;
				expect(forbiddenApi("src/probe.ts", content)).toBeNull();
				const port = createToolPort(
					createCodeTools({ directory: task, workDir: work }),
				);
				expect(
					(
						await port.invoke(
							{ tool: "write_file", input: { path: "src/probe.ts", content } },
							new AbortController().signal,
						)
					).status,
				).toBe("ok");
				await writeFile(
					join(work, "test/probe.test.ts"),
					`import { test, expect } from "bun:test";
import { probe } from "../src/probe.ts";
test("OS boundary", async () => expect(await probe()).toEqual({inside:true,outside:false,home:false,network:false}));`,
				);
				const outcome = await port.invoke(
					{ tool: "run_tests", input: {} },
					AbortSignal.timeout(5000),
				);
				expect(outcome.output).toMatchObject({ passed: true });
				expect(outcome.status).toBe("ok");
				expect(existsSync(outside)).toBe(false);
				expect(await readFile(privateFile, "utf8")).toBe("private fixture");
			} finally {
				server.stop(true);
				await rm(dir, { recursive: true, force: true });
				await rm(homeDir, { recursive: true, force: true });
			}
		},
	);

	test("refuses execution when no sandbox is available", async () => {
		const dir = await mkdtemp(join(tmpdir(), "code-no-sandbox-"));
		try {
			const work = join(dir, "work");
			await mkdir(work);
			await writeFile(
				join(work, "probe.test.ts"),
				`import { test } from "bun:test"; test("must not run", () => {});`,
			);
			// Isolate the module mock from other tests. A missing sandbox must never fall back to Bun directly.
			const child = Bun.spawn(
				[
					process.execPath,
					"-e",
					`
import { mock } from "bun:test";
import * as fs from "node:fs";
mock.module("node:fs", () => ({ ...fs, existsSync: () => false }));
const { runBunTest } = await import(${JSON.stringify(new URL("../code.ts", import.meta.url).href)});
try { await runBunTest(${JSON.stringify(work)}, "./probe.test.ts", undefined, ${JSON.stringify(dir)}); console.log("EXECUTED"); }
catch (error) { console.log(error.message); }
`,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await child.exited).toBe(0);
			expect((await new Response(child.stdout).text()).trim()).toBe(
				"sandbox_unavailable",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a workspace boundary is required", async () => {
		await expect(runBunTest(tmpdir(), "./test/")).rejects.toThrow(
			"sandbox_workspace_required",
		);
	});
});
