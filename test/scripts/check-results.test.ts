import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	parsePublished,
	resultViolations,
} from "../../scripts/check-results.ts";

const published = parsePublished("# comment\nbase-2\n\nmath-4  # note\n");

describe("run artifacts stay out of commits (check-results)", () => {
	test("PUBLISHED lists run names; comments and blank lines are ignored", () => {
		expect([...published]).toEqual(["base-2", "math-4"]);
	});

	test("records, summaries and analyses of published runs are allowed", () => {
		expect(
			resultViolations(
				[
					"eval/results/PUBLISHED",
					"eval/results/base-2/runs.jsonl",
					"eval/results/base-2/summary.md",
					"eval/results/math-4/analysis.md",
					"src/index.ts",
				],
				published,
			),
		).toEqual([]);
	});

	test("unpublished runs, other files of a published run, nested output and databases fail", () => {
		const bad = resultViolations(
			[
				"eval/results/abl1-direct-r1/runs.jsonl",
				"eval/results/zz-int-a/summary.md",
				"eval/results/base-2/ledger.sqlite",
				"eval/results/base-2/configs/abc.json",
				"eval/results/base-2/direct/t-r1.jsonl",
				"data/pursuit.db-wal",
			],
			published,
		);
		expect(bad).toHaveLength(6);
		expect(bad[0]).toContain('run "abl1-direct-r1" is not in');
		expect(bad[2]).toContain("database file");
		expect(bad[3]).toContain("only runs.jsonl, summary.md and analysis.md");
	});

	test("the repository's own index passes, and every tracked result belongs to a published run", () => {
		const root = resolve(import.meta.dir, "../..");
		const git = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root });
		if (git.exitCode !== 0) return; // not a git work tree (e.g. an unpacked tarball)
		const paths = git.stdout.toString().split("\0").filter(Boolean);
		const list = parsePublished(
			readFileSync(resolve(root, "eval/results/PUBLISHED"), "utf8"),
		);
		expect(resultViolations(paths, list)).toEqual([]);
	});
});
