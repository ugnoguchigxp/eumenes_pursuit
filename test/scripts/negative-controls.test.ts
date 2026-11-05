import { expect, test } from "bun:test";
import {
	mkdtemp,
	cp,
	symlink,
	mkdir,
	readFile,
	writeFile,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
for (const kind of ["acceptance", "comparison", "os-boundary"] as const)
	test(`negative control detects disabled ${kind} protection in an isolated copy`, async () => {
		const dir = await mkdtemp(join(tmpdir(), "pursuit-negative-"));
		try {
			for (const folder of ["src", "standalone", "test", "config", "eval"])
				await cp(join(root, folder), join(dir, folder), {
					recursive: true,
					filter: (path) => !path.includes("/results/"),
				});
			await mkdir(join(dir, "eval/results/base-2"), { recursive: true });
			await cp(
				join(root, "eval/results/base-2/runs.jsonl"),
				join(dir, "eval/results/base-2/runs.jsonl"),
			);
			await symlink(
				join(root, "node_modules"),
				join(dir, "node_modules"),
				"dir",
			);
			await cp(join(root, "package.json"), join(dir, "package.json"));
			const target =
				kind === "acceptance"
					? "test/scenario/engine.test.ts"
					: kind === "comparison"
						? "eval/test/compare-cli.test.ts"
						: "eval/tools/test/code.test.ts";
			async function run() {
				const proc = Bun.spawn([process.execPath, "test", target], {
					cwd: dir,
					stdout: "pipe",
					stderr: "pipe",
					env: {
						PATH: process.env.PATH!,
						HOME: process.env.HOME!,
						PURSUIT_LIVE: "0",
					},
				});
				const output = await new Response(proc.stderr).text();
				return { code: await proc.exited, output };
			}
			const normal = await run();
			expect(normal.code, normal.output.slice(-2000)).toBe(0);
			if (kind === "acceptance") {
				await writeFile(
					join(dir, "src/domains/rules/acceptance.ts"),
					`import type {CriterionResult} from '../../contracts/index.ts';export function acceptancePassed(_a:readonly {id:string}[],c:readonly CriterionResult[]){return c.every(r=>r.passed)}`,
				);
			} else if (kind === "comparison") {
				const path = join(dir, "eval/analyze.ts");
				const s = await readFile(path, "utf8");
				expect(s).toContain("last.set(recordKey(r), r);");
				await writeFile(
					path,
					s.replace(
						"last.set(recordKey(r), r);",
						"last.set(`${r.task}|${r.condition}|${r.generator}|${r.repeat}`, r);",
					),
				);
			} else if (process.platform === "darwin") {
				const path = join(dir, "eval/tools/code.ts"),
					s = await readFile(path, "utf8");
				expect(s).toContain('"(deny network*)",');
				await writeFile(path, s.replace('"(deny network*)",', ""));
			} else {
				const path = join(dir, "eval/tools/sandbox.ts"),
					s = await readFile(path, "utf8");
				expect(s).toContain('"--unshare-all",');
				await writeFile(
					path,
					s.replace(
						'"--unshare-all",',
						'"--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts",',
					),
				);
			}
			const disabled = await run();
			expect(disabled.code).not.toBe(0);
			expect(disabled.output).toContain("(fail)");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 30000);
