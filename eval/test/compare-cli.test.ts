import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("compare CLI preserves different config IDs and deduplicates real retries", async () => {
	const parent = join(import.meta.dir, "../results");
	const dir = await mkdtemp(join(parent, "compare-contract-"));
	try {
		const fixture = JSON.parse(
			(await readFile(join(parent, "base-2/runs.jsonl"), "utf8")).split(
				"\n",
			)[0]!,
		);
		const rows = [
			{
				...fixture,
				configId: "A",
				correct: false,
				outcome: "stopped",
				verified: false,
			},
			{
				...fixture,
				configId: "B",
				correct: true,
				outcome: "completed",
				verified: true,
			},
		];
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "runs.jsonl"),
			[...rows, rows[1]].map((r) => JSON.stringify(r)).join("\n"),
		);
		const proc = Bun.spawn(
			[
				process.execPath,
				"eval/analyze.ts",
				"--compare",
				dir.split("/").at(-1)!,
			],
			{ cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
		);
		const out = await new Response(proc.stdout).text();
		expect(await proc.exited).toBe(0);
		expect(out).toContain("@A");
		expect(out).toContain("@B");
		expect(out).toContain("0%");
		expect(out).toContain("100%");
		expect(out).not.toContain("50%");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
