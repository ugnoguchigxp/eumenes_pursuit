import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	firstOutputMismatch,
	validSqlCount,
	type MeasurementMetric,
	type Runner,
} from "../../../eval/optimizer/benchmark.ts";
import { runIsolatedBun } from "../../../eval/tools/code.ts";
import { edgeCases, generated, workload } from "./data.ts";

export const rankingName = "isucon12-ranking";
export const rankingSqlName = "isucon12-ranking-sql";
const candidateFile = "ranking.ts";
const timingRequests = 144;
const acceptanceRequests = 192;
const read = (file: string) => readFile(new URL(file, import.meta.url), "utf8");

const rankingRunner =
	(metric?: MeasurementMetric): Runner =>
	async (source, input, timeoutMs, signal, diagnoseMismatch) => {
		signal.throwIfAborted();
		const directory = await mkdtemp(join(tmpdir(), "optimizer-ranking-"));
		try {
			const work = join(directory, "work");
			await Promise.all(
				["work", "hidden", "data"].map((dir) => mkdir(join(directory, dir))),
			);
			await Promise.all([
				writeFile(join(work, candidateFile), source),
				writeFile(join(work, "driver.ts"), await read("driver.ts")),
			]);
			const deadline = AbortSignal.timeout(timeoutMs);
			const started = performance.now();
			const result = await runIsolatedBun(
				work,
				["run", "driver.ts", ...(metric ? ["--count-sql"] : [])],
				AbortSignal.any([signal, deadline]),
				directory,
				input.input,
			);
			const ms = performance.now() - started;
			signal.throwIfAborted();
			if (deadline.aborted || result.timedOut || ms > timeoutMs)
				return { ms, status: "timeout" };
			if (result.exitCode !== 0) return { ms, status: "failed" };
			const newline = result.stdout.indexOf("\n");
			const header = result.stdout.slice(0, newline);
			const sqlStatements =
				metric && /^\d+$/.test(header) ? Number(header) : undefined;
			if (metric && !validSqlCount(sqlStatements))
				return { ms, status: "failed" };
			const output = metric ? result.stdout.slice(newline + 1) : result.stdout;
			if (output === input.expected)
				return {
					ms,
					status: "ok",
					...(sqlStatements === undefined ? {} : { sqlStatements }),
				};
			const mismatch = diagnoseMismatch
				? firstOutputMismatch(input.expected, output)
				: undefined;
			return { ms, status: "incorrect", ...(mismatch ? { mismatch } : {}) };
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	};

export const runRanking = rankingRunner();

export async function rankingFixture(metric?: MeasurementMetric) {
	const [initialSource, specification, reference] = await Promise.all([
		read(candidateFile),
		read("spec.md"),
		metric ? undefined : read("reference.ts"),
	]);
	return {
		initialSource,
		baselineSource: initialSource,
		expectedCorrect: true,
		specification: metric
			? specification.split("\n\n").slice(0, -1).join("\n\n") +
				"\n\n渡される接続では `query(sql)` または `prepare(sql)` で1つの文を準備し、`all`・`get`・`values`・`iterate` で実行できます。バインド値は通常の SQLite と同じです。この接続を使って読み取りを行い、テーブルや採点器を変更しないでください。SQLを実行するたびに1回と数え、準備や採点器側の入稿は数えません。開発負荷と未使用データで、順位を維持したまま初期版よりSQL実行回数を減らしてください。\n"
			: specification,
		...(reference === undefined ? {} : { reference }),
		candidateFile,
		run: metric ? rankingRunner(metric) : runRanking,
		...(metric ? { metric } : {}),
		operationUnit: "requests" as const,
		timingOperations: timingRequests,
		operationCount: acceptanceRequests,
		calibrationRounds: 2,
		goal: metric
			? "ISUCON12予選のランキング処理を切り出した ranking.ts を改善する。順位を維持しながらランキング照会時のSQL実行回数を減らし、計測済みの最良版を提出する。"
			: `ISUCON12予選のランキング処理を切り出した ranking.ts を高速化する。README.md のランキングの結果を維持し、${acceptanceRequests}件の照会を3秒以内で処理する。正しさと速度の改善を検証した最良版を提出する。`,
		correctnessText: "ランキングの結果が固定した正しさの検査をすべて通る",
		correctness: [
			workload("edge-cases", edgeCases),
			workload("development-mixed", generated(9203, 135, 8, 3)),
		],
		timing: [
			workload("read-heavy", generated(8219, 2400, timingRequests / 2, 2)),
			workload("with-reuploads", generated(1523, 1900, timingRequests / 4, 4)),
		],
		large: [
			workload(
				"development-requests",
				generated(6208, 2700, acceptanceRequests / 3, 3),
			),
		],
	};
}

export function rankingHeldOut() {
	return {
		correctness: [workload("audit-mixed", generated(9959, 189, 11, 4))],
		speed: [
			workload(
				"audit-requests",
				generated(2210, 3100, acceptanceRequests / 4, 4),
			),
		],
	};
}
