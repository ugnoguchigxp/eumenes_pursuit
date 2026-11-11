import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createPursuitEngine,
	policySchema,
	type JsonObject,
	type LlmPort,
	type PursuitView,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { stepWithDeadline } from "../../standalone/deadline.ts";
import { openStore } from "../../standalone/store.ts";
import { conditionsFor } from "../conditions.ts";
import {
	completeSeries,
	improvements,
	measure,
	percentile,
	runCandidate,
	type Runner,
} from "./benchmark.ts";
import { digest } from "./candidates.ts";
import { correctnessSuite, eventsFor, profiles, workload } from "./data.ts";
import {
	acceptance,
	goal,
	grants,
	loadBaseline,
	openOptimizer,
} from "./task.ts";

// Fixed test candidate. It is outside the workspace that the Optimizer can read.
export const faster = `
import sys
from collections import defaultdict

def main():
    stream = iter(sys.stdin.buffer)
    n = int(next(stream))
    groups = defaultdict(list)
    for i in range(n):
        t, user, amount = next(stream).split()
        groups[user].append((int(t), i, int(amount)))
    result = [0] * n
    for group in groups.values():
        group.sort()
        left = right = total = 0
        while right < len(group):
            time = group[right][0]
            begin = right
            while right < len(group) and group[right][0] == time:
                total += group[right][2]
                right += 1
            while group[left][0] <= time - 3600:
                total -= group[left][2]
                left += 1
            for i in range(begin, right):
                result[group[i][1]] = total
    sys.stdout.write("".join(f"{total}\\n" for total in result))

if __name__ == "__main__":
    main()
`;
export const wrong = faster.replace("<= time - 3600", "< time - 3600");
export const slower = "import time\ntime.sleep(0.15)\n" + faster;

const action = (tool: string, input: JsonObject = {}) => ({
	tool,
	inputJson: JSON.stringify(input),
	text: null,
	expectedStatus: "ok",
	expectedObservation: "対象版について試行結果を記録する",
	whatChanged: "仮説を次の測定と照合する",
	refutedIf: "status:error",
});
const write = (content: string) =>
	action("write_file", { path: "windowsum.py", content });
const check = () => action("check_candidate");
const time = () => action("measure_candidate");
const script = [
	{
		actions: [write(faster), check(), time()],
		kind: "initial",
		change: "利用者ごとに整列して窓の走査を短くする",
	},
	{
		actions: [write(wrong), check()],
		kind: "evidence",
		change: "改善した版を記録したので境界の変更を別候補で検証する",
	},
	{
		actions: [write(slower), check(), time()],
		kind: "constraint",
		change: "境界条件を壊した候補は棄却し、出力を維持した別候補を測る",
	},
	{
		actions: [action("restore_best"), action("read_candidate")],
		kind: "evidence",
		change: "速度が悪化したため確認済みの版を復元する",
	},
];
const fixed: LlmPort = {
	async complete(request) {
		let value: unknown;
		if (request.purpose === "plan") {
			value = {
				strategy: "候補を一つずつ検証",
				rationale: "同じ入力で速度と正しさを照合",
				alternatives: [],
			};
		} else if (request.purpose === "hypothesize") {
			value = {
				hypothesis: "窓をまとめて処理すると速くなる",
				rationale: "同じ利用者の走査を再利用できる",
				expected: "正しさを保ち速度が改善する",
				tools: [
					"write_file",
					"check_candidate",
					"measure_candidate",
					"restore_best",
					"read_candidate",
				],
				targets: ["windowsum.py"],
			};
		} else {
			const state = JSON.parse(request.prompt.split("\n\n").at(-1)!) as {
				basis: string;
				newlyUnassessed: number[];
				attempts: { seq: number; state: string }[];
				choiceViolations: string[];
			};
			assert.deepEqual(state.choiceViolations, []);
			const next = [0, 3, 5, 8].indexOf(state.attempts.length);
			const choice = script[next];
			assert.ok(choice, `unexpected attempt count ${state.attempts.length}`);
			value = {
				basis: state.basis,
				progress: {
					assessed: state.newlyUnassessed,
					kind: choice.kind,
					change: choice.change,
					criteria: ["correctness", "speed", "version"],
					evidence: state.attempts
						.filter(
							(a) =>
								a.state === "settled" && state.newlyUnassessed.includes(a.seq),
						)
						.map((a) => a.seq),
					conclusions: [],
				},
				choice: next === 3 ? "complete" : "act",
				reason: choice.change,
				missing: "",
				contribution: choice.change,
				route: "advance",
				actions: choice.actions,
				sequence: true,
				cancelPending: false,
				waitAfterDispatch: false,
				renewHypothesis: null,
				renewStrategy: null,
			};
		}
		return {
			value: request.schema.parse(value),
			model: "optimizer-fixed",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			latencyMs: 0,
		};
	},
};

export async function fixedScenario(
	directory: string,
	run: Runner = runCandidate,
	real = true,
) {
	await mkdir(directory, { recursive: true });
	const signal = AbortSignal.timeout(240000);
	const initial = await loadBaseline();
	const timing = profiles.map((profile) =>
		workload(profile, eventsFor(profile, real ? 3000 : 20, 20261111)),
	);
	const correctness = correctnessSuite(735);
	const large = [
		workload("development-200000", eventsFor("mixed", real ? 200000 : 20, 124)),
	];
	const calibration = {
		initial: await measure(run, initial, initial, timing, signal),
		fast: await measure(run, faster, faster, timing, signal),
	};
	assert.ok(
		[...calibration.initial, ...calibration.fast].every(completeSeries),
		"optimizer_calibration_incomplete",
	);
	const noise = Object.fromEntries(
		timing.map(({ id }, i) => [
			id,
			percentile(
				[
					...improvements(calibration.initial[i]!),
					...improvements(calibration.fast[i]!),
				].map(Math.abs),
				0.95,
			),
		]),
	);
	const options = {
		directory,
		run,
		correctness,
		timing,
		large,
		noise,
		environment: real
			? `${process.platform}-${process.arch}/bun-${Bun.version}/python-${Bun.spawnSync(["/usr/bin/python3", "--version"]).stdout.toString().trim()}`
			: "deterministic-fixture",
	};
	const ledgerPath = join(directory, "ledger.sqlite");
	const makeEngine = (store: ReturnType<typeof openStore>) =>
		createPursuitEngine({
			store,
			clock: { now: Date.now },
			ids: { next: () => crypto.randomUUID() },
			generator: fixed,
			reviewer: fixed,
			judge: null,
		});
	let store = openStore(ledgerPath, migrations);
	let engine = makeEngine(store);
	let task = await openOptimizer(options);
	let paused = false;
	try {
		const policy = policySchema.parse(
			JSON.parse(
				await readFile(
					new URL("../../config/policy.v1.json", import.meta.url),
					"utf8",
				),
			),
		);
		const { pursuitId } = await engine.start(
			{
				goal,
				acceptance,
				grant: grants,
				policy: {
					...policy,
					budget: {
						...policy.budget,
						attempts: 20,
						attemptsPerHypothesis: 12,
						wallMs: 240000,
					},
				},
				conditions: conditionsFor("productive", {
					adapter: null,
					language: "ja",
					findings: "off",
					strategyChange: "free",
					selfCheck: "off",
					verifyOn: "claim",
					prediction: "falsifiable",
					completionCheck: "acceptance",
				}),
				goalRef: null,
				label: "optimizer-window-sums",
			},
			"optimizer-fixed",
		);
		let view: PursuitView | null = null;
		for (let stepCount = 0; stepCount < 100; stepCount++) {
			let step = await stepWithDeadline(
				engine,
				pursuitId,
				task.runtime,
				signal,
			);
			if (step.pendingDecision) {
				const id = step.pendingDecision.operationId;
				const request = await engine.decisionRequest(pursuitId, id);
				step = await engine.completeDecision(
					pursuitId,
					id,
					await fixed.complete(request, signal),
					task.runtime,
					signal,
				);
			}
			view = await engine.view(pursuitId);
			assert.ok(view);
			if (step.done) break;
			if (
				!paused &&
				view.attempts.length === 8 &&
				view.attempts.every((a) => a.state === "settled")
			) {
				assert.equal(task.candidates.best().version, digest(faster));
				assert.equal(
					digest(await readFile(join(directory, "work/windowsum.py"), "utf8")),
					digest(slower),
				);
				task.close();
				store.close();
				task = await openOptimizer(options);
				store = openStore(ledgerPath, migrations);
				engine = makeEngine(store);
				assert.equal(task.candidates.best().version, digest(faster));
				paused = true;
			}
		}
		assert.ok(paused);
		assert.equal(
			view?.status,
			"completed",
			JSON.stringify(view?.report ?? view?.productive),
		);
		assert.equal(view.report?.verified, true);
		assert.equal(view.attempts.length, 10);
		assert.equal(task.candidates.best().version, digest(faster));
		const history = task.candidates.history();
		assert.deepEqual(
			history.map((m) => m.promoted),
			[1, 0],
		);
		const heldOut = profiles.map((profile) =>
			workload(
				`held-out-${profile}`,
				eventsFor(profile, real ? 200000 : 20, 452819),
			),
		);
		const audit = await task.audit(correctnessSuite(1993), heldOut, signal);
		assert.equal(audit.passed, true);
		const published = join(directory, "windowsum.py");
		await writeFile(published, task.candidates.best().source, { flag: "wx" });
		assert.equal(digest(await readFile(published, "utf8")), audit.version);
		return {
			status: view.status,
			verified: view.report.verified,
			resumed: paused,
			environment: options.environment,
			protocol: task.protocol,
			baseline: task.candidates.initial,
			final: audit.version,
			noise,
			calibration,
			history,
			attempts: view.attempts.map(({ seq, tool, observation }) => ({
				seq,
				tool,
				observation,
			})),
			audit,
			published,
		};
	} finally {
		task.close();
		store.close();
	}
}
