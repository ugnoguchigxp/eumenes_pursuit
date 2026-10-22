import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { familyOf } from "../../../metrics.ts";
import { sandboxAvailable } from "../../../tools/sandbox.ts";
import { tasks } from "../../index.ts";
import { loadWork } from "../env.ts";
import { horizon11Tasks } from "../horizon-long.ts";

const signal = AbortSignal.timeout(120_000);
const maybe = sandboxAvailable() ? test : test.skip;
const find = (id: string) => horizon11Tasks.find((t) => t.id === id)!;
const ENV_IDS = [
	"hz11-legacy-billing",
	"hz11-black-box",
	"hz11-messy-ledger",
	"hz11-sales-pipeline",
];

/** Fixture checks only (trivial commands); the real hidden cases live outside the repository. */
function fixtureSecrets(
	id: string,
	cases: unknown[],
	extra: Record<string, string>,
) {
	const secretDir = mkdtempSync(join(tmpdir(), "hz11-secrets-"));
	mkdirSync(join(secretDir, id), { recursive: true });
	for (const [rel, text] of Object.entries(extra)) {
		mkdirSync(join(secretDir, id, rel, ".."), { recursive: true });
		writeFileSync(join(secretDir, id, rel), text);
	}
	writeFileSync(
		join(secretDir, `${id}.json`),
		JSON.stringify({ id, kind: "env", cases }),
	);
	return secretDir;
}

async function instance(id: string, secretDir?: string) {
	const dir = mkdtempSync(join(tmpdir(), "hz11-task-"));
	const inst = await find(id).create(dir, {
		grader: null,
		toolTier: 0,
		...(secretDir ? { secretDir } : {}),
	});
	const invoke = (tool: string, input: Record<string, unknown>) =>
		inst.tools.invoke({ tool, input: input as never }, signal);
	return {
		inst,
		invoke,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

describe("horizon-11 long-horizon tasks", () => {
	test("five tasks, registered once, in the hz11 family", () => {
		expect(horizon11Tasks.map((t) => t.id)).toEqual([
			...ENV_IDS,
			"hz11-water-ratio",
		]);
		for (const t of horizon11Tasks) {
			expect(tasks.filter((x) => x.id === t.id)).toHaveLength(1);
			expect(familyOf({ task: t.id, group: t.group })).toBe("hz11");
			expect(t.traps.length).toBeGreaterThan(0);
		}
	});

	test("goals name no host-only material and no planted-material vocabulary", () => {
		for (const t of horizon11Tasks) {
			const g = t.goalFor?.(0) ?? t.goal;
			expect(g).not.toMatch(
				/hz_author_private|secret|canary|カナリア|注入|injection|仕込/i,
			);
		}
	});

	test("the probe budget is tight and only the black box has a device", () => {
		for (const id of ENV_IDS)
			expect(find(id).grant.includes("env.probe")).toBe(
				id === "hz11-black-box",
			);
		expect(find("hz11-black-box").goal).toContain("probe");
	});

	test("initial work trees are large enough to need many reads", async () => {
		const billing = Object.keys(await loadWork("hz11-legacy-billing"));
		expect(
			billing.filter((p) => p.endsWith(".py")).length,
		).toBeGreaterThanOrEqual(25);
		expect(billing).toContain("CHANGELOG.md");
		expect(
			billing.filter((p) => p.startsWith("docs/")).length,
		).toBeGreaterThanOrEqual(5);
		const ledger = Object.keys(await loadWork("hz11-messy-ledger"));
		expect(
			ledger.filter((p) => p.startsWith("data/") && p.endsWith(".csv")).length,
		).toBe(3);
		const pipeline = Object.keys(await loadWork("hz11-sales-pipeline"));
		expect(
			pipeline.filter((p) => p.startsWith("sql/")).length,
		).toBeGreaterThanOrEqual(10);
		expect(
			pipeline.filter((p) => p.startsWith("input/")).length,
		).toBeGreaterThan(20);
	});

	maybe(
		"visible billing tests pass on the initial tree; the pipeline builds",
		async () => {
			const b = await instance("hz11-legacy-billing");
			try {
				const r = await b.invoke("run", {
					command: "python3 -m unittest discover -s tests 2>&1 | tail -1",
				});
				expect(JSON.stringify(r.output)).toContain("OK");
			} finally {
				b.cleanup();
			}
			const p = await instance("hz11-sales-pipeline");
			try {
				const r = await p.invoke("run", {
					command: "bash build.sh && wc -l < out/report.txt",
				});
				expect(r.status).toBe("ok");
				expect(JSON.stringify(r.output)).toContain("report: out/report.txt");
			} finally {
				p.cleanup();
			}
		},
	);

	maybe("verification counts fixture checks on a copy of work", async () => {
		const secretDir = fixtureSecrets(
			"hz11-messy-ledger",
			[
				{
					name: "has-answers",
					command: "test -f answers.json && echo yes || echo no",
					expected: "cases/yes.out",
					timeoutMs: 10_000,
				},
			],
			{ "cases/yes.out": "yes\n" },
		);
		const t = await instance("hz11-messy-ledger", secretDir);
		try {
			expect((await t.inst.acceptance.verify(signal))[0]!.passed).toBe(false);
			await t.invoke("write_file", { path: "answers.json", content: "{}" });
			const [c] = await t.inst.acceptance.verify(signal);
			expect(c!.passed).toBe(true);
			expect(c!.evidence).toBe("隠された検査 1/1 通過");
		} finally {
			t.cleanup();
			rmSync(secretDir, { recursive: true, force: true });
		}
	});

	test("the research question states every formula it is graded on", () => {
		const g = find("hz11-water-ratio").goal;
		for (const k of [
			"distributed_m3",
			"billed_m3",
			"revenue_ratio_pct",
			"household_lpcd",
			"給水人口",
			"四捨五入",
		])
			expect(g).toContain(k);
	});
});
