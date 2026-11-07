import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import {
	appendFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openSettings } from "../../standalone/settings.ts";

let directory = "";
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "runner-contract-"));
	const source = resolve(import.meta.dir, "../..");
	for (const folder of ["src", "standalone", "eval", "config"])
		await cp(join(source, folder), join(directory, folder), {
			recursive: true,
			filter: (path) =>
				!path.includes("/results/") && !path.endsWith("/results"),
		});
	for (const file of ["package.json", "bun.lock"])
		await cp(join(source, file), join(directory, file));
	await symlink(join(source, "node_modules"), join(directory, "node_modules"));
	appendFileSync(
		join(directory, "eval/tasks/index.ts"),
		`
for (const id of ["setup-failure", "delayed-worker"]) tasks.push({
 id, group:"A", title:id, goal:id, acceptance:[{id:"total",text:"fixture",method:"machine"}],
 grant:[], consultAnswer:"fixture", expected:"completed", traps:[],
 async create(){
  if(id==="setup-failure"){await Bun.sleep(150);throw new Error("setup failed "+process.env.OPENAI_API_KEY);}
  return {tools:{list:()=>[],invoke:async()=>{throw new Error("unused")}},workspace:null,
   acceptance:{verify:async()=>[{id:"total",passed:false,evidence:"fixture"}]},dispose:async()=>{}};
 }
});\n`,
	);
	writeFileSync(
		join(directory, "standalone/larm/connection.ts"),
		`
export function openDecisionLease(){return {
 judge:{maxQuestions:1,ask:async()=>{throw new Error("unused")}},
 release:async()=>{throw new Error("lease release failed "+process.env.LARM_API_TOKEN)}
};}\n`,
	);
	const settings = openSettings(
		join(directory, "data/pursuit-settings.sqlite"),
	);
	try {
		settings.set("spend.limitUsd", 1);
		settings.set("spend.pricing", { fixture: { input: 1, output: 1 } });
		settings.set("larm.controlOrigin", "http://127.0.0.1:1");
		settings.set("larm.decisionProfile", "fixture");
		settings.set("larm.audience", "fixture");
		settings.set("larm.clientId", "fixture");
		for (const role of ["llm.generator", "llm.reviewer"] as const)
			settings.set(role, {
				model: "fixture",
				effort: "medium",
				thinkingHeadroom: 0,
			});
		// Exhaust the isolated budget so planning/reporting can be exercised without an LLM request.
		settings
			.meter()
			.record("fixture", { input_tokens: 1000000, output_tokens: 0 });
	} finally {
		settings.close();
	}
});
afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function run(
	args: string[],
	environment: Record<string, string> = {},
	responder = join(directory, "responder"),
) {
	const child = Bun.spawn(
		[
			process.execPath,
			"eval/main.ts",
			...args,
			...(args[0] === "run" ? ["--llm-dir", responder] : []),
		],
		{
			cwd: directory,
			env: {
				PATH: process.env.PATH!,
				HOME: directory,
				PURSUIT_LIVE: "0",
				...environment,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const timer = setTimeout(() => child.kill(), 5000);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { code, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}
const options = [
	"--conditions",
	"D0",
	"--llm",
	"file",
	"--grader-llm",
	"none",
	"--concurrency",
	"1",
];

test("AUTO resumes the same pursuit in a fresh CLI process without selecting or executing the tool again", async () => {
	appendFileSync(
		join(directory, "eval/tasks/index.ts"),
		`
tasks.push({id:"resume-fixture",resumable:true,group:"A",title:"fixture",goal:"fixture",
acceptance:[{id:"total",text:"one observed operation",method:"machine"}],grant:["data.read"],consultAnswer:"fixture",expected:"completed",traps:[],
async create(directory){const fs=await import("node:fs"),path=directory+"/observations.txt";
return {workspace:null,tools:{list:()=>[{name:"read",description:"fixture",inputSchema:{type:"object",properties:{}},permission:"data.read",sideEffect:"none"}],invoke:async()=>{fs.appendFileSync(path,"effect\\n");return {status:"ok",output:"observed",refs:[]}}},
acceptance:{verify:async()=>[{id:"total",passed:fs.existsSync(path)&&fs.readFileSync(path,"utf8")==="effect\\n",evidence:"actual operation count"}]},dispose:async()=>{}};}});
`,
	);
	const settings = openSettings(
		join(directory, "data/pursuit-settings.sqlite"),
	);
	settings.set("spend.limitUsd", 2);
	settings.close();
	const responder = join(directory, "resume-responder");
	await mkdir(join(responder, "requests"), { recursive: true });
	await mkdir(join(responder, "responses"), { recursive: true });
	let resuming = false;
	const answer = () => {
		for (const filename of readdirSync(join(responder, "requests"))) {
			const target = join(responder, "responses", filename);
			if (existsSync(target)) continue;
			const request = JSON.parse(
				readFileSync(join(responder, "requests", filename), "utf8"),
			);
			const value =
				request.purpose === "select"
					? { condition: "E1R", reason: "fixture selection" }
					: request.purpose === "plan"
						? {
								strategy: "observe once",
								rationale: "fixture",
								alternatives: [],
							}
						: request.purpose === "hypothesize"
							? {
									hypothesis: "one observation",
									rationale: "fixture",
									tools: ["read"],
									expected: "observed",
								}
							: {
									kind: resuming ? "done" : "tool",
									tool: "read",
									inputJson: "{}",
									text: null,
									expectedStatus: "ok",
									expectedObservation: "observed",
									whatChanged: "",
									message: "fixture",
									missing: "",
								};
			writeFileSync(target, JSON.stringify(value));
		}
	};
	const timer = setInterval(answer, 10);
	const args = [
		"run",
		"--name",
		"resume-integration",
		...options,
		"--verify-on",
		"claim",
		"--conditions",
		"AUTO",
		"--tasks",
		"resume-fixture",
		"--max-steps",
		"25",
		"--pause-after-tools",
		"1",
	];
	try {
		const initial = await run(args, {}, responder);
		expect(initial.code).toBe(0);
		expect(initial.stdout).toContain("[paused]");
		const root = join(directory, "eval/results/resume-integration");
		const checkpoint = JSON.parse(
			readFileSync(
				join(root, "checkpoints", readdirSync(join(root, "checkpoints"))[0]!),
				"utf8",
			),
		);
		resuming = true;
		const resumed = await run([...args, "--resume"], {}, responder);
		expect(resumed.code).toBe(0);
		const record = JSON.parse(
			readFileSync(join(root, "runs.jsonl"), "utf8").trim(),
		);
		expect(record).toMatchObject({
			pursuitId: checkpoint.pursuitId,
			correct: true,
			toolCalls: 1,
			selectedCondition: "E1R",
			restarts: 1,
		});
		expect(record.usage.byRole.selector.calls).toBe(1);
		const config = JSON.parse(
			readFileSync(join(root, "configs", record.configId + ".json"), "utf8"),
		);
		expect(config.roles.selector.provider).toBe("file");
		expect(
			new Set(
				record.usage.events.map(
					(event: { scope: { jobId: string } }) => event.scope.jobId,
				),
			).size,
		).toBe(1);
	} finally {
		clearInterval(timer);
		const restored = openSettings(
			join(directory, "data/pursuit-settings.sqlite"),
		);
		restored.set("spend.limitUsd", 1);
		restored.close();
	}
}, 15000);

test("grader directories cannot alias or nest inside the generator directory", async () => {
	const responder = join(directory, "responder");
	await mkdir(responder, { recursive: true });
	const alias = join(directory, "grader-alias");
	await symlink(responder, alias);
	for (const grader of [alias, join(responder, "grader"), directory]) {
		const result = await run([
			"run",
			"--name",
			"private-boundary",
			...options,
			"--tasks",
			"a-missing-budget",
			"--grader-llm",
			"file",
			"--grader-dir",
			grader,
		]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"--grader-dir must be disjoint from --llm-dir",
		);
	}
});

test("new responder directories are separated using the filesystem's filename rules", async () => {
	const probe = join(directory, "CaseProbe");
	await mkdir(probe);
	const foldsCase = existsSync(join(directory, "caseprobe"));
	const generator = join(directory, "NewResponder");
	const grader = join(directory, "newresponder");
	const result = await run(
		[
			"run",
			"--name",
			"case-boundary",
			...options,
			"--tasks",
			"a-missing-budget",
			"--grader-llm",
			"file",
			"--grader-dir",
			grader,
		],
		{},
		generator,
	);
	if (foldsCase) {
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"--grader-dir must be disjoint from --llm-dir",
		);
	} else expect(result.code).toBe(0);
});

test("the real CLI preserves earlier unrecorded plans when another subset is requested", async () => {
	for (const task of ["a-missing-budget", "a-stale-supplier-price"])
		expect(
			(await run(["run", "--name", "retained", ...options, "--tasks", task]))
				.code,
		).toBe(0);
	const root = join(directory, "eval/results/retained");
	const planned = JSON.parse(
		readFileSync(join(root, "planned-jobs.json"), "utf8"),
	);
	expect(planned.map((job: { task: string }) => job.task)).toEqual([
		"a-missing-budget",
		"a-stale-supplier-price",
	]);
	expect(readFileSync(join(root, "summary.md"), "utf8")).toContain(
		"未記録 2 件",
	);
});

for (const [flag, value] of [
	["--repeat", "0"],
	["--repeat", "1.5"],
	["--concurrency", "NaN"],
	["--concurrency", "0"],
	["--max-steps", "NaN"],
	["--max-steps", "0"],
	["--conditions", "D0,D0"],
])
	test(`CLI rejects ${flag}=${value} before replacing plans or requesting an LLM`, async () => {
		const result = await run([
			"run",
			"--name",
			"invalid",
			...options,
			flag!,
			value!,
		]);
		expect(result.code).not.toBe(0);
		expect(
			existsSync(join(directory, "eval/results/invalid/planned-jobs.json")),
		).toBe(false);
	});

test("special directory names cannot write a report outside a run directory", async () => {
	for (const name of [".", ".."])
		expect((await run(["report", "--name", name])).code).not.toBe(0);
	expect(existsSync(join(directory, "eval/summary.md"))).toBe(false);
	expect(existsSync(join(directory, "eval/results/summary.md"))).toBe(false);
});

test("a failed worker drains the active worker before closing its usage database", async () => {
	const settings = openSettings(
		join(directory, "data/pursuit-settings.sqlite"),
	);
	settings.set("spend.limitUsd", 2);
	settings.close();
	const secret = "fixture-reflected-sdk-secret";
	const pending = run(
		[
			"run",
			"--name",
			"draining",
			...options,
			"--tasks",
			"setup-failure,delayed-worker",
			"--concurrency",
			"2",
		],
		{ OPENAI_API_KEY: secret },
	);
	const requestDir = join(directory, "responder/requests");
	let request = "";
	for (let i = 0; i < 100; i++) {
		if (existsSync(requestDir))
			request =
				readdirSync(requestDir).find((name) => name.endsWith(".json")) ?? "";
		if (request) break;
		await Bun.sleep(20);
	}
	expect(request).not.toBe("");
	await Bun.sleep(250);
	writeFileSync(
		join(directory, "responder/responses", request),
		JSON.stringify({
			kind: "give_up",
			tool: null,
			inputJson: null,
			text: null,
			message: "fixture ending",
		}),
	);
	const result = await pending;
	expect(result.code).not.toBe(0);
	const recordsPath = join(directory, "eval/results/draining/runs.jsonl");
	expect(existsSync(recordsPath)).toBe(true);
	const rows = readFileSync(recordsPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ task: "delayed-worker", error: null });
	expect(result.stderr).not.toContain(secret);
	const events = readFileSync(
		join(directory, "eval/results/draining/job-events.jsonl"),
		"utf8",
	);
	expect(events).not.toContain(secret);
	expect(events).toContain("<redacted>");
});

test("lease release failure does not suppress summary output or expose its token", async () => {
	const settings = openSettings(
		join(directory, "data/pursuit-settings.sqlite"),
	);
	settings.set("spend.limitUsd", 1);
	settings.close();
	const secret = "fixture-release-token-secret";
	const result = await run(
		[
			"run",
			"--name",
			"release-failure",
			...options,
			"--conditions",
			"E2",
			"--tasks",
			"a-missing-budget",
		],
		{ LARM_API_TOKEN: secret },
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).not.toContain(secret);
	const summary = join(directory, "eval/results/release-failure/summary.md");
	expect(existsSync(summary)).toBe(true);
	expect(readFileSync(summary, "utf8")).toContain("未記録 1 件");
});
