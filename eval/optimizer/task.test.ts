import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observationText } from "../../src/domains/generation/prompts.ts";
import type { Runner } from "./benchmark.ts";
import { digest } from "./candidates.ts";
import { correctnessSuite } from "./data.ts";
import { faster, fixedScenario, slower, wrong } from "./fixed.ts";
import { loadBaseline, openOptimizer } from "./task.ts";

const run: Runner = async (source) => ({
	status: source === wrong ? "incorrect" : "ok",
	ms: source === faster ? 20 : source === slower ? 50 : 100,
});

test("frozen productive engine promotes, rejects an incorrect and a slower version, reopens and restores", async () => {
	const dir = await mkdtemp(join(tmpdir(), "optimizer-engine-"));
	try {
		const result = await fixedScenario(dir, run, false);
		expect(result.status).toBe("completed");
		expect(result.audit.passed).toBe(true);
		expect(result.resumed).toBe(true);
		expect(result.final).toBe(digest(faster));
		const measured = result.attempts.filter(
			({ tool }) => tool === "measure_candidate",
		);
		const rejected = measured[1]?.observation?.output;
		expect(rejected).toMatchObject({
			version: digest(slower),
			control: digest(faster),
			promoted: false,
			evidence: [
				{ id: "mixed", reason: "primary_regression" },
				{ id: "concentrated", reason: "secondary_regression" },
				{ id: "distributed", reason: "secondary_regression" },
			],
		});
		const displayed = observationText(rejected!, 1800, undefined);
		expect(displayed).toContain('"id":"distributed"');
		expect(displayed).toContain('"reason":"secondary_regression"');
		expect(displayed).toContain('"thresholdMs":0');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("manual selection rejects an old comparison and requires an explicit adoption", async () => {
	const dir = await mkdtemp(join(tmpdir(), "optimizer-manual-"));
	const input = correctnessSuite(9)[0]!;
	const task = await openOptimizer({
		directory: dir,
		correctness: [input],
		timing: [input],
		large: [input],
		noise: { [input.id]: 2 },
		environment: "manual-selection",
		run,
		selection: "manual",
	});
	const signal = new AbortController().signal;
	const tool = (name: string, input = {}) =>
		task.runtime.tools.invoke({ tool: name, input }, signal);
	const write = (content: string) =>
		tool("write_file", { path: "windowsum.py", content });
	try {
		await write(slower);
		await tool("check_candidate");
		expect((await tool("measure_candidate")).output).toMatchObject({
			measurement: 1,
			eligible: true,
			promoted: false,
		});
		await write(faster);
		await tool("check_candidate");
		expect((await tool("measure_candidate")).output).toMatchObject({
			measurement: 2,
			eligible: true,
			promoted: false,
		});
		expect(task.candidates.best().version).toBe(task.candidates.initial);
		await write(slower);
		expect((await tool("adopt_candidate", { measurement: 2 })).errorCode).toBe(
			"optimizer_measurement_not_adoptable",
		);
		expect((await tool("adopt_candidate", { measurement: 1 })).status).toBe(
			"ok",
		);
		await write(faster);
		expect((await tool("adopt_candidate", { measurement: 2 })).errorCode).toBe(
			"optimizer_measurement_not_adoptable",
		);
		expect((await tool("measure_candidate")).output).toMatchObject({
			measurement: 3,
			eligible: true,
			promoted: false,
		});
		expect((await tool("adopt_candidate", { measurement: 3 })).status).toBe(
			"ok",
		);
		expect(task.candidates.best().version).toBe(digest(faster));
		expect(task.candidates.history().map(({ promoted }) => promoted)).toEqual([
			1, 0, 1,
		]);
	} finally {
		task.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("tool boundary blocks unchecked versions and preserves best across an aborted measurement", async () => {
	const dir = await mkdtemp(join(tmpdir(), "optimizer-task-"));
	const correctness = correctnessSuite(9);
	const input = correctness[0]!;
	let stop: AbortController | undefined;
	const abortable: Runner = async (...args) => {
		if (stop) stop.abort(new Error("forced interruption"));
		args[3].throwIfAborted();
		return run(...args);
	};
	const options = {
		directory: dir,
		correctness,
		timing: [input],
		large: [input],
		noise: { [input.id]: 2 },
		environment: "integration",
		run: abortable,
	};
	let host = await openOptimizer(options);
	const invoke = (
		tool: string,
		input = {},
		signal = new AbortController().signal,
	) => host.runtime.tools.invoke({ tool, input }, signal);
	const write = (content: string) =>
		invoke("write_file", { path: "windowsum.py", content });
	try {
		expect(
			(await invoke("write_file", { path: "README.md", content: "change" }))
				.errorCode,
		).toBe("optimizer_protected_path");
		await write(faster);
		expect((await invoke("measure_candidate")).errorCode).toBe(
			"optimizer_unchecked_version",
		);
		await invoke("check_candidate");
		expect((await invoke("measure_candidate")).output).toMatchObject({
			promoted: true,
		});
		await write(wrong);
		expect((await invoke("check_candidate")).output).toMatchObject({
			passed: false,
		});
		expect((await invoke("measure_candidate")).errorCode).toBe(
			"optimizer_unchecked_version",
		);
		await write(slower);
		await invoke("check_candidate");
		stop = new AbortController();
		await expect(invoke("measure_candidate", {}, stop.signal)).rejects.toThrow(
			"forced interruption",
		);
		stop = undefined;
		host.close();
		host = await openOptimizer(options);
		expect(host.candidates.history().map((r) => r.state)).toEqual([
			"done",
			"interrupted",
		]);
		expect((await invoke("measure_candidate")).errorCode).toBe(
			"optimizer_interrupted",
		);
		expect(
			(await host.runtime.acceptance.verify(new AbortController().signal)).map(
				(r) => r.passed,
			),
		).toEqual([true, false, false]);
		await invoke("restore_best");
		expect((await invoke("read_candidate")).output).toMatchObject({
			matches: true,
		});
		expect(await readFile(join(dir, "work/windowsum.py"), "utf8")).toBe(faster);
	} finally {
		host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("an incorrect starter stays separate from the verified comparison version", async () => {
	const dir = await mkdtemp(join(tmpdir(), "optimizer-starter-"));
	const input = correctnessSuite(9)[0]!;
	const host = await openOptimizer({
		directory: dir,
		correctness: [input],
		timing: [input],
		large: [input],
		noise: { [input.id]: 2 },
		environment: "starter-test",
		initialSource: wrong,
		run,
	});
	const signal = new AbortController().signal;
	try {
		expect(await readFile(join(dir, "work/windowsum.py"), "utf8")).toBe(wrong);
		expect(host.candidates.best().version).toBe(digest(await loadBaseline()));
		expect(
			(
				await host.runtime.tools.invoke(
					{ tool: "check_candidate", input: {} },
					signal,
				)
			).output,
		).toMatchObject({ passed: false });
		expect(
			(
				await host.runtime.tools.invoke(
					{ tool: "measure_candidate", input: {} },
					signal,
				)
			).errorCode,
		).toBe("optimizer_unchecked_version");
	} finally {
		host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
