import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandSandboxAvailable } from "../../../tools/sandbox.ts";
import { tasks } from "../../index.ts";
import { loadSecret } from "../discovery.ts";
import { loadWork } from "../env.ts";
import { horizon13Tasks } from "../horizon-frontier.ts";

const frontier = join(import.meta.dir, "../frontier");
const python = Bun.which("python3");
const signal = AbortSignal.timeout(380_000);

test("the three frontier tasks are registered with a specification and tier-1 samples", async () => {
	expect(horizon13Tasks.map((t) => t.id)).toEqual([
		"hz13-bracelets",
		"hz13-ising-ring",
		"hz13-equilibrium",
	]);
	for (const task of horizon13Tasks) {
		expect(tasks).toContain(task);
		expect(Object.keys(await loadWork(task.id)).sort()).toEqual([
			"README.md",
			"samples/t1.in",
			"samples/t1.out",
		]);
	}
});

for (const task of horizon13Tasks) {
	const name = task.id.slice("hz13-".length);
	const reference = join(frontier, name, "reference.py");

	test.skipIf(!python)(
		`${task.id}: the reference reproduces the visible samples`,
		async () => {
			const work = await loadWork(task.id);
			const result = Bun.spawnSync([python!, reference], {
				stdin: work["samples/t1.in"]!,
			});
			expect(result.stdout.toString()).toBe(work["samples/t1.out"]!.toString());
		},
	);

	test.skipIf(!python)(
		`${task.id}: the generator writes twelve vetted checks that the reference passes`,
		async () => {
			const secretDir = mkdtempSync(join(tmpdir(), "hz13-secrets-"));
			try {
				const built = Bun.spawnSync(
					[
						python!,
						join(frontier, "generate.py"),
						name,
						"424242",
						join(secretDir, task.id),
					],
					{ timeout: 280_000 },
				);
				expect(built.exitCode).toBe(0);
				const cases = [1, 2, 3, 4, 5, 6].flatMap((tier) =>
					["a", "b"].map((part) => ({
						name: `t${tier}${part}`,
						command: "python3 solve.py",
						stdin: `t${tier}${part}.in`,
						expected: `t${tier}${part}.out`,
						timeoutMs: 20000,
					})),
				);
				writeFileSync(
					join(secretDir, `${task.id}.json`),
					JSON.stringify({ id: task.id, kind: "env", cases }),
				);
				expect((await loadSecret(secretDir, task.id)).kind).toBe("env");
				for (const item of cases) {
					const answer = Bun.spawnSync([python!, reference], {
						stdin: readFileSync(join(secretDir, task.id, item.stdin)),
					});
					expect(answer.stdout.toString()).toBe(
						readFileSync(join(secretDir, task.id, item.expected), "utf8"),
					);
				}
				if (!commandSandboxAvailable()) return;
				// In the sandbox the hidden checks accept the reference and reject an empty answer.
				const directory = mkdtempSync(join(tmpdir(), "hz13-task-"));
				try {
					const instance = await task.create(directory, {
						grader: null,
						toolTier: 0,
						secretDir,
					});
					mkdirSync(join(directory, "work"), { recursive: true });
					writeFileSync(join(directory, "work", "solve.py"), "print(0)\n");
					const empty = await instance.acceptance.verify(signal);
					expect(empty.map((c) => c.id)).toEqual(
						[1, 2, 3, 4, 5, 6].map((tier) => `tier-${tier}`),
					);
					expect(empty.some((c) => c.passed)).toBe(false);
					writeFileSync(
						join(directory, "work", "solve.py"),
						readFileSync(reference),
					);
					const solved = await instance.acceptance.verify(signal);
					expect(solved.every((c) => c.passed)).toBe(true);
					expect(instance.diagnostics?.()).toMatchObject({
						hiddenPassed: 12,
						tiersPassed: [true, true, true, true, true, true],
					});
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			} finally {
				rmSync(secretDir, { recursive: true, force: true });
			}
		},
		400_000,
	);
}
