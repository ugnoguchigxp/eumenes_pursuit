import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conditionsFor } from "../../eval/conditions.ts";
import { digest } from "../../eval/optimizer/candidates.ts";
import {
	acceptance,
	grants,
	openOptimizer,
} from "../../eval/optimizer/task.ts";
import {
	createPursuitEngine,
	type JsonObject,
	type LlmPort,
} from "../../src/index.ts";
import { migrations } from "../../src/sqlite.ts";
import { openStore } from "../../standalone/store.ts";
import { hypothesis, plan, scripted } from "../../test/scenario/harness.ts";
import { startInput } from "../../test/support.ts";
import { optimizerWorkflow } from "./workflow.ts";

const candidateFile = "ranking.ts";
const baseline = "baseline\n";
const correct = "correct improvement\n";
const incorrect = "incorrect improvement\n";
const workload = (id: string) => ({ id, input: "", expected: "" });
const action = (tool: string, input: JsonObject = {}) => ({
	tool,
	inputJson: JSON.stringify(input),
	text: null,
	expectedStatus: "ok",
	expectedObservation: "現在の対象版の結果を受け取る",
	whatChanged: "作業を次の検証に進める",
	refutedIf: "status:error",
});
const reads = [
	action("read_file", { path: candidateFile }),
	action("read_file", { path: "README.md" }),
];
const write = (content: string) =>
	action("write_file", { path: candidateFile, content });
const check = action("check_candidate");
const measureAndRead = [action("measure_candidate"), action("read_candidate")];
const edit = (content: string) => [write(content), check, ...measureAndRead];

async function fixedWorkflow(
	batches: readonly (readonly ReturnType<typeof action>[])[],
) {
	const directory = await mkdtemp(join(tmpdir(), "optimizer-workflow-"));
	const store = openStore(":memory:", migrations);
	try {
		const executions: { source: string; input: string }[] = [];
		const task = await openOptimizer({
			directory,
			candidateFile,
			initialSource: baseline,
			baselineSource: baseline,
			specification: "順位の結果を維持する。",
			correctness: [workload("development-check")],
			timing: [workload("comparison")],
			large: [workload("development-acceptance")],
			noise: { comparison: 0 },
			environment: "fixed-workflow",
			async run(source, { id }) {
				executions.push({ source, input: id });
				return source === incorrect
					? {
							status: "incorrect",
							ms: 10,
							mismatch: { line: 1, expected: "expected", actual: "wrong" },
						}
					: { status: "ok", ms: source === correct ? 10 : 100 };
			},
		});
		try {
			const initial = scripted({
				plan: [plan],
				hypothesize: [
					{ ...hypothesis, tools: ["read_file"], targets: [candidateFile] },
				],
			});
			const instruction = optimizerWorkflow(candidateFile);
			let decisions = 0;
			const generator: LlmPort = {
				async complete(request, signal) {
					if (request.purpose !== "propose")
						return initial.llm.complete(request, signal);
					const parts = request.prompt.split("\n\n");
					expect(JSON.parse(parts[0]!).goal).toContain(instruction);
					const { basis, newlyUnassessed, attempts, choiceViolations } =
						JSON.parse(parts.at(-1)!);
					expect(choiceViolations).toEqual([]);
					const first = decisions === 0;
					const actions = batches[decisions++];
					if (!actions) throw new Error("unexpected additional decision");
					const afterFailedCheck =
						attempts.at(-1)?.error === "optimizer_unchecked_version";
					if (afterFailedCheck) {
						expect(attempts.at(-2)?.observation).toContain('"passed":false');
						expect(attempts.at(-2)?.observation).toContain('"actual":"wrong"');
						expect(task.candidates.history()).toHaveLength(0);
					}
					const change = afterFailedCheck
						? "不一致を修正して再検査する"
						: "対象版の根拠を検査する";
					return {
						value: request.schema.parse({
							basis,
							progress: {
								assessed: newlyUnassessed,
								kind: first
									? "initial"
									: afterFailedCheck
										? "constraint"
										: "evidence",
								change,
								criteria: ["correctness", "speed", "version"],
								evidence: newlyUnassessed,
								conclusions: [],
							},
							choice: actions.length ? "act" : "complete",
							reason: change,
							missing: "",
							contribution: change,
							route: "advance",
							actions,
							sequence: actions.length > 1,
							cancelPending: false,
							waitAfterDispatch: false,
							renewHypothesis: null,
							renewStrategy: null,
						}),
						model: "fixed-workflow",
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						latencyMs: 0,
					};
				},
			};
			const engine = createPursuitEngine({
				store,
				clock: { now: Date.now },
				ids: { next: () => crypto.randomUUID() },
				generator,
				reviewer: generator,
				judge: null,
			});
			const input = startInput({
				goal: `ランキング処理を改善する。\n${instruction}`,
				acceptance: [...acceptance],
				grant: [...grants],
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
			});
			const { pursuitId } = await engine.start(
				{
					...input,
					policy: {
						...input.policy,
						budget: { ...input.policy.budget, attemptsPerHypothesis: 10 },
					},
				},
				"optimizer-workflow",
			);
			const signal = AbortSignal.timeout(5000);
			for (let i = 0; i < 50; i++) {
				let step = await engine.step(pursuitId, task.runtime, signal);
				if (step.pendingDecision) {
					const id = step.pendingDecision.operationId;
					const request = await engine.decisionRequest(pursuitId, id);
					step = await engine.completeDecision(
						pursuitId,
						id,
						await generator.complete(request, signal),
						task.runtime,
						signal,
					);
				}
				if (step.done) break;
			}
			const view = (await engine.view(pursuitId))!;
			expect(view.status).toBe("completed");
			expect(view.report?.verified).toBe(true);
			const audit = await task.audit(
				[workload("held-out-check")],
				[workload("held-out-performance")],
				signal,
			);
			expect(audit).toMatchObject({ passed: true, version: digest(correct) });
			return {
				decisions,
				attempts: view.attempts,
				executions,
				measurements: task.candidates.history(),
			};
		} finally {
			task.close();
		}
	} finally {
		store.close();
		await rm(directory, { recursive: true, force: true });
	}
}

test("grouped reads and candidate verification use three fixed decisions instead of six", async () => {
	const split = await fixedWorkflow([
		[reads[0]!],
		[reads[1]!],
		[write(correct)],
		[check],
		measureAndRead,
		[],
	]);
	const grouped = await fixedWorkflow([reads, edit(correct), []]);
	expect(split.decisions).toBe(6);
	expect(grouped.decisions).toBe(3);
	expect(grouped.attempts.map(({ tool, input }) => ({ tool, input }))).toEqual(
		split.attempts.map(({ tool, input }) => ({ tool, input })),
	);
	expect(grouped.executions).toEqual(split.executions);
});

test("a failed check blocks measurement and returns to a fixed repair decision", async () => {
	const result = await fixedWorkflow([
		reads,
		edit(incorrect),
		edit(correct),
		[],
	]);
	expect(result.decisions).toBe(4);
	expect(
		result.attempts
			.slice(3, 6)
			.map(({ tool, observation }) => [tool, observation?.errorCode]),
	).toEqual([
		["check_candidate", null],
		["measure_candidate", "optimizer_unchecked_version"],
		["write_file", null],
	]);
	expect(
		result.executions
			.filter(({ source }) => source === incorrect)
			.map(({ input }) => input),
	).toEqual(["development-check"]);
	expect(result.measurements).toHaveLength(1);
	expect(result.measurements[0]).toMatchObject({ promoted: 1 });
});
