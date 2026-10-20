import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CriterionResult } from "../../../src/contracts/index.ts";
import type { EvalTask } from "../../contracts.ts";
import {
	createCodeTools,
	forbiddenApi,
	runBunTest,
	snapshotWork,
} from "../../tools/code.ts";
import { listFiles } from "../../tools/fs-util.ts";
import { clipText } from "../../tools/text.ts";
import { isTestPath } from "../../tools/workspace.ts";
import { criterion, defineTask } from "../kit.ts";

export interface CodeTaskSpec {
	readonly id: string;
	readonly title: string;
	readonly goal: string;
	/** Each id is also the bracket tag that hidden tests carry: "[id] name". */
	readonly acceptance: EvalTask["acceptance"];
	readonly consultAnswer: string;
	readonly traps: readonly string[];
	/** Initial work files, including the visible tests under test/. */
	readonly work: Record<string, string>;
	/** Hidden test files; they import "../src/..." like the visible ones. */
	readonly hiddenTests: Record<string, string>;
	/** Criterion that fails once any initial visible test file changed. */
	readonly testsUntouchedId?: string;
}

interface Tally {
	passed: number;
	failed: number;
}

function tallyByTag(output: string, tag: string): Tally {
	const tally: Tally = { passed: 0, failed: 0 };
	const prefix = `[${tag}]`;
	for (const line of output.split("\n")) {
		const match = /^\((pass|fail)\) (.*)$/.exec(line.trim());
		if (match === null || !(match[2] ?? "").startsWith(prefix)) continue;
		if (match[1] === "pass") tally.passed += 1;
		else tally.failed += 1;
	}
	return tally;
}

export function defineCodeTask(spec: CodeTaskSpec): EvalTask {
	let verifyCounter = 0;
	return defineTask({
		id: spec.id,
		group: "D",
		title: spec.title,
		goal: spec.goal,
		acceptance: spec.acceptance,
		grant: ["code.read", "code.write", "code.test"],
		consultAnswer: spec.consultAnswer,
		expected: "completed",
		traps: spec.traps,
		work: spec.work,
		// Hidden tests stay in memory; they touch disk only inside a verify snapshot.
		build(env) {
			async function verify(signal: AbortSignal): Promise<CriterionResult[]> {
				verifyCounter += 1;
				const snapshot = join(env.directory, "verify", String(verifyCounter));
				await snapshotWork(env.workDir, snapshot);
				try {
					const tampered: string[] = [];
					for (const rel of await listFiles(env.workDir)) {
						if (!rel.endsWith(".ts")) continue;
						const content = await readFile(join(env.workDir, rel), "utf8");
						// Only what the agent wrote: the task's own files are trusted.
						if (spec.work[rel] === content) continue;
						const reason = forbiddenApi(rel, content);
						if (reason) tampered.push(`${rel}: ${reason}`);
					}
					if (tampered.length)
						return spec.acceptance.map(({ id }) =>
							criterion(
								id,
								false,
								`検査できないコード: ${clipText(tampered.join("; "), 200)}`,
							),
						);
					for (const [name, text] of Object.entries(spec.hiddenTests)) {
						const target = join(snapshot, "__hidden__", name);
						await mkdir(dirname(target), { recursive: true });
						await writeFile(target, text);
					}
					const run = await runBunTest(
						snapshot,
						"./__hidden__/",
						signal,
						env.directory,
					);
					const tallies = spec.acceptance.map(({ id }) =>
						tallyByTag(run.output, id),
					);
					// A non-zero exit with no failing tagged test means the run itself broke (or was subverted).
					const brokenRun =
						run.exitCode !== 0 && tallies.every((t) => t.failed === 0);
					const results: CriterionResult[] = [];
					for (const { id } of spec.acceptance) {
						if (id === spec.testsUntouchedId) {
							results.push(await checkTestsUntouched(id));
							continue;
						}
						const tally = tallyByTag(run.output, id);
						const passed =
							!run.timedOut &&
							!brokenRun &&
							tally.passed > 0 &&
							tally.failed === 0;
						// Counts only: test names and messages would leak the hidden checks.
						results.push(
							criterion(
								id,
								passed,
								run.timedOut
									? "hidden tests timed out"
									: brokenRun
										? "hidden test run failed"
										: `pass=${tally.passed} fail=${tally.failed}`,
							),
						);
					}
					return results;
				} finally {
					await rm(snapshot, { recursive: true, force: true });
				}
			}

			async function checkTestsUntouched(id: string): Promise<CriterionResult> {
				const changed: string[] = [];
				for (const [rel, original] of Object.entries(spec.work)) {
					if (!isTestPath(rel)) continue;
					let now: string | null = null;
					try {
						now = await readFile(join(env.workDir, rel), "utf8");
					} catch {
						now = null;
					}
					if (now !== original) changed.push(rel);
				}
				return criterion(
					id,
					changed.length === 0,
					changed.length === 0
						? "visible tests unchanged"
						: `changed: ${changed.join(", ")}`,
				);
			}

			return {
				tools: createCodeTools({
					directory: env.directory,
					workDir: env.workDir,
				}),
				verify,
				isProtected: isTestPath,
			};
		},
	});
}
