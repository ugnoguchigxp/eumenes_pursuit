import { expect, test } from "bun:test";
import { mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkCorrectness,
	firstOutputMismatch,
	measure,
	promotes,
	runCandidate,
	type Runner,
	type Series,
} from "./benchmark.ts";
import { digest, openCandidates } from "./candidates.ts";
import { sandboxAvailable } from "../tools/sandbox.ts";
import {
	bruteForce,
	correctnessSuite,
	eventsFor,
	profiles,
	reference,
} from "./data.ts";

test.skipIf(!sandboxAvailable())(
	"Python candidates cannot see host files or environment and time out independently",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "optimizer-boundary-"));
		const marker = join(directory, "marker");
		const variable = "PURSUIT_OPTIMIZER_TEST_MARKER";
		const previous = process.env[variable];
		try {
			await writeFile(marker, "test marker");
			process.env[variable] = "test marker";
			const network = await readlink("/proc/self/ns/net");
			const source = `
import os
print(os.path.exists(${JSON.stringify(marker)}), ${JSON.stringify(variable)} in os.environ,
      os.readlink("/proc/self/ns/net") != ${JSON.stringify(network)})
`;
			const input = {
				id: "boundary",
				input: "",
				expected: "False False True\n",
			};
			const signal = AbortSignal.timeout(5000);
			expect((await runCandidate(source, input, 1500, signal)).status).toBe(
				"ok",
			);
			expect(
				(await runCandidate("import time; time.sleep(10)", input, 200, signal))
					.status,
			).toBe("timeout");
		} finally {
			if (previous === undefined) delete process.env[variable];
			else process.env[variable] = previous;
			await rm(directory, { recursive: true, force: true });
		}
	},
);

test("diagnoses an exact output mismatch without showing other rows", async () => {
	expect(
		firstOutputMismatch("first\nsecond\nsecret\n", "first\ndifferent\n"),
	).toEqual({
		line: 2,
		expected: "second\n",
		actual: "different\n",
	});
	expect(firstOutputMismatch("first\n", "first")).toEqual({
		line: 1,
		expected: "first\n",
		actual: "first",
	});
	expect(firstOutputMismatch("first\n", "first\nextra\n")).toEqual({
		line: 2,
		expected: null,
		actual: "extra\n",
	});
	expect(
		firstOutputMismatch("a".repeat(161), "b".repeat(161))?.actual,
	).toHaveLength(160);
	const mismatch = { line: 1, expected: "expected\n", actual: "actual\n" };
	const run: Runner = async () => ({ ms: 1, status: "incorrect", mismatch });
	const checks = [{ id: "case", input: "", expected: "" }];
	const signal = new AbortController().signal;
	expect(await checkCorrectness(run, "", checks, signal)).toEqual([
		{ id: "case", status: "incorrect" },
	]);
	expect(await checkCorrectness(run, "", checks, signal, true)).toEqual([
		{ id: "case", status: "incorrect", mismatch },
	]);
});

test("reference agrees with the direct specification at boundaries and across seeded distributions", () => {
	const boundary = [
		[3600, "a", 5],
		[0, "a", 8],
		[1, "a", -2],
		[3600, "b", 9],
		[3600, "a", -3],
	] as const;
	expect(bruteForce(boundary)).toEqual([0, 8, 6, 9, 0]);
	expect(reference(boundary)).toEqual([0, 8, 6, 9, 0]);
	for (const profile of profiles)
		for (let seed = 0; seed < 12; seed++) {
			const events = eventsFor(profile, 75, seed);
			expect(reference(events)).toEqual(bruteForce(events));
		}
});

const signal = AbortSignal.timeout(10000);
const suite = correctnessSuite(1);
const input = suite[0]!;
const run: Runner = async (source) => ({
	ms: source === "baseline" ? 100 : source === "slower" ? 65 : 30,
	status:
		source === "wrong" ? "incorrect" : source === "timeout" ? "timeout" : "ok",
});

test("correctness evidence has no timing; paired timing alternates the execution order", async () => {
	const checked = await checkCorrectness(run, "wrong", [input], signal);
	expect(checked).toEqual([{ id: input.id, status: "incorrect" }]);
	const order: string[] = [];
	const timed = await measure(
		(...args) => {
			order.push(args[0]);
			return run(...args);
		},
		"baseline",
		"faster",
		[input],
		signal,
	);
	expect(order.slice(0, 8)).toEqual([
		"baseline",
		"faster",
		"baseline",
		"faster",
		"faster",
		"baseline",
		"baseline",
		"faster",
	]);
	expect(timed[0]?.pairs).toHaveLength(7);
	expect(promotes(timed, { [input.id]: 2 })).toBe(true);
	expect(promotes(timed, { [input.id]: 71 })).toBe(false);
	for (const source of ["wrong", "timeout"]) {
		const failed = await measure(run, "baseline", source, [input], signal);
		expect(promotes(failed, { [input.id]: 2 })).toBe(false);
	}
});

test("each secondary distribution guards against performance regressions", async () => {
	const good = (await measure(run, "baseline", "faster", [input], signal))[0]!;
	const bad: Series = {
		...good,
		id: "other",
		pairs: good.pairs.map(({ control, candidate }) => ({
			control: candidate,
			candidate: control,
		})),
	};
	expect(promotes([good, bad], { [input.id]: 2, other: 3 })).toBe(false);
});

test("candidate receipts survive reopening, interrupted work is charged, and stale results cannot promote", async () => {
	const dir = await mkdtemp(join(tmpdir(), "optimizer-receipts-"));
	const path = join(dir, "optimizer.sqlite");
	const store = () => openCandidates(path, "baseline", "protocol", 3);
	let candidates = store();
	try {
		expect(() => candidates.begin(digest("wrong"), false)).toThrow(
			"optimizer_unchecked_version",
		);
		const faster = candidates.markChecked("faster", true);
		const first = candidates.begin(faster, false);
		if (first.kind !== "started") throw new Error(first.kind);
		const result = await measure(run, "baseline", "faster", [input], signal);
		expect(candidates.finish(first.id, result, { [input.id]: 2 })).toBe(true);
		const slower = candidates.markChecked("slower", true);
		const trial = candidates.begin(slower, false);
		if (trial.kind !== "started") throw new Error(trial.kind);
		candidates.close();
		candidates = store();
		expect(candidates.best().version).toBe(faster);
		expect(candidates.begin(slower, false).kind).toBe("interrupted");
		expect(() =>
			candidates.finish(trial.id, result, { [input.id]: 2 }),
		).toThrow("optimizer_stale_measurement");
		const retry = candidates.begin(slower, true);
		if (retry.kind !== "started") throw new Error(retry.kind);
		const worse = await measure(run, "faster", "slower", [input], signal);
		expect(candidates.finish(retry.id, worse, { [input.id]: 2 })).toBe(false);
		expect(candidates.begin(slower, false).kind).toBe("cached");
		expect(
			candidates.begin(candidates.markChecked("another", true), false).kind,
		).toBe("budget");
		expect(candidates.best().source).toBe("faster");
		expect(() => openCandidates(path, "baseline", "other", 3)).toThrow(
			"optimizer_protocol_changed",
		);
	} finally {
		candidates.close();
		await rm(dir, { recursive: true, force: true });
	}
});
