import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOptimizer } from "../../../eval/optimizer/task.ts";
import { isolatedBunAvailable } from "../../../eval/tools/code.ts";
import { calibrate, selectStarters } from "../fixtures.ts";
import { edgeCases, workload } from "./data.ts";
import {
	rankingFixture,
	rankingHeldOut,
	rankingName,
	runRanking,
} from "./fixture.ts";

test("the ISUCON ranking is selectable by itself and is outside the existing suite", () => {
	expect(selectStarters(rankingName, "api")).toEqual([rankingName]);
	expect(selectStarters("all", "api")).not.toContain(rankingName);
});

test("the oracle keeps the last score, breaks ties by row, paginates and replaces an upload", () => {
	expect(
		workload("edge", edgeCases)
			.expected.trimEnd()
			.split("\n")
			.map((row) => JSON.parse(row)),
	).toEqual([
		[
			[1, 7, "q", "Q"],
			[2, 7, "p", "星"],
			[3, -4, "r", "R"],
		],
		[
			[2, 7, "p", "星"],
			[3, -4, "r", "R"],
		],
		[[1, 8, "p", "Other tenant"]],
		[],
		[],
		[[1, 1, "p", "星"]],
		[[1, 8, "p", "Other tenant"]],
		[],
		[[1, 8, "p", "Other tenant"]],
	]);
});

test.skipIf(!isolatedBunAvailable())(
	"the ranking candidate must pass SQLite checks, real measurement and independent audit",
	async () => {
		const data = await rankingFixture();
		const reference = data.reference!;
		const signal = AbortSignal.timeout(90000);
		const stale = reference.replace(" || board.revision !== revision", "");
		const check = data.correctness[0]!;
		expect(
			await runRanking(data.initialSource, check, 3000, signal),
		).toMatchObject({ status: "ok" });
		expect(await runRanking(stale, check, 3000, signal, true)).toMatchObject({
			status: "incorrect",
			mismatch: { line: 6 },
		});
		const { noise, additional } = await calibrate(data, signal);
		expect(additional).toHaveLength(1);
		const directory = await mkdtemp(join(tmpdir(), "optimizer-ranking-test-"));
		const task = await openOptimizer({
			...data,
			directory,
			noise,
			environment: `${process.platform}/${Bun.version}`,
		});
		const tool = (name: string, input = {}) =>
			task.runtime.tools.invoke({ tool: name, input }, signal);
		try {
			expect(
				(await tool("write_file", { path: "README.md", content: "rewrite" }))
					.errorCode,
			).toBe("optimizer_protected_path");
			expect(
				(
					await tool("write_file", {
						path: data.candidateFile,
						content: reference,
					})
				).status,
			).toBe("ok");
			expect((await tool("check_candidate")).output).toMatchObject({
				passed: true,
			});
			expect((await tool("measure_candidate")).output).toMatchObject({
				promoted: true,
			});
			expect(
				(await task.runtime.acceptance.verify(signal)).every(
					({ passed }) => passed,
				),
			).toBe(true);
			const { correctness, speed } = rankingHeldOut();
			expect(await task.audit(correctness, speed, signal)).toMatchObject({
				passed: true,
			});
		} finally {
			task.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
	95000,
);
