import { describe, expect, test } from "bun:test";
import type {
	PursuitRuntime,
	ToolDescriptor,
	ToolOutcome,
} from "../../src/index.ts";
import { read } from "./harness.ts";
import { call, hypothesis, plan, proposal, run, runtime } from "./harness.ts";

/**
 * A workspace kept in memory with real checkpoints, restore (honouring keep.dirs) and
 * filesCreated, so the engine's classification of task files, scratch work and generated
 * outputs runs as with the evaluation host's directory workspace.
 */
function memoryWorkspace(initial: Record<string, string>) {
	let files = new Map(Object.entries(initial));
	const checkpoints = new Map<string, Map<string, string>>();
	const restores: (readonly string[] | undefined)[] = [];
	const ws: NonNullable<PursuitRuntime["workspace"]> = {
		checkpoint: async () => {
			const id = String(checkpoints.size + 1);
			checkpoints.set(id, new Map(files));
			return id;
		},
		restore: async (id, keep) => {
			const kept = (p: string) =>
				!!keep && p.split("/").some((s) => keep.dirs.includes(s));
			const next = new Map([...checkpoints.get(id)!].filter(([p]) => !kept(p)));
			for (const [p, c] of files) if (kept(p)) next.set(p, c);
			files = next;
			restores.push(keep?.dirs);
		},
		digest: async () => JSON.stringify([...files].sort()),
		changesSince: async (id) => {
			const base = checkpoints.get(id)!;
			const touched = [...new Set([...base.keys(), ...files.keys()])]
				.filter((p) => base.get(p) !== files.get(p))
				.sort();
			return {
				filesTouched: touched,
				linesChanged: touched.length,
				protectedTouched: [],
				filesCreated: touched.filter((p) => !base.has(p)),
			};
		},
	};
	return { ws, files: () => files, restores };
}

const writeTool: ToolDescriptor = {
	name: "write_file",
	description: "",
	inputSchema: {},
	sideEffect: "workspace",
	permission: "answer.write",
};
const runTool: ToolDescriptor = { ...writeTool, name: "run" };

/** write_file writes its path; run applies the edits named by its `effect` input. */
function host(
	initial: Record<string, string>,
	effects: Record<string, Record<string, string>>,
) {
	const mem = memoryWorkspace(initial);
	const rt = runtime({
		ws: mem.ws,
		tools: [read, writeTool, runTool],
		invoke: (tool, input): ToolOutcome => {
			if (tool === "write_file")
				mem.files().set(String(input.path), String(input.content ?? "x"));
			if (tool === "run")
				for (const [p, c] of Object.entries(
					effects[String(input.effect)] ?? {},
				))
					mem.files().set(p, c);
			return { status: "ok", output: { ok: true }, refs: [] };
		},
	});
	return { ...mem, rt };
}

const quiet = (restore: "always" | "protective") => (p: any) => ({
	...p,
	restore,
	budget: { ...p.budget, attemptsPerHypothesis: 20, strategies: 1 },
	signals: { ...p.signals, scopeGrowth: 3, consecutiveFailures: 50 },
});
const scopeSignals = (view: Awaited<ReturnType<typeof run>>["view"]) =>
	view.decisions.filter(
		(d) =>
			Array.isArray(d.basis.signals) &&
			d.basis.signals.includes("scope_growth"),
	);

describe("scope growth and protective restore on real hz11f sequences (spec/fixes-2026-10-22-b.md §1)", () => {
	test("legacy-billing H2: one hypothesis fixing six existing files in two directories is not scope growth and nothing is reverted", async () => {
		// hz11f-pursuit-r1, hz11-legacy-billing, attempts #6–#8: write anniversary.py, write
		// credits.py, then a run that rewrites engine/proration/tiers/discounts via heredocs.
		// v1.7 counted +1, +1, +4 new task files, fired scope_growth=3 at #8 and reverted all six.
		const src = (name: string) => `kumobill/${name}`;
		const initial = Object.fromEntries(
			[
				"cycles/anniversary.py",
				"pricing/credits.py",
				"pricing/discounts.py",
				"pricing/engine.py",
				"pricing/proration.py",
				"pricing/tiers.py",
				"README.md",
			].map((f) => [f === "README.md" ? f : src(f), "old"]),
		);
		const h = host(initial, {
			rewrite: Object.fromEntries(
				["engine", "proration", "tiers", "discounts"].map((n) => [
					src(`pricing/${n}.py`),
					"new",
				]),
			),
		});
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [{ ...hypothesis, tools: ["write_file", "run"] }],
				propose: [
					call("write_file", {
						path: src("cycles/anniversary.py"),
						content: "new",
					}),
					call("write_file", {
						path: src("pricing/credits.py"),
						content: "new",
					}),
					call("run", { effect: "rewrite" }),
					proposal("give_up"),
				],
			},
			policy: quiet("protective"),
			runtime: h.rt,
		});
		expect(view.attempts.filter((a) => a.state === "settled")).toHaveLength(3);
		expect(scopeSignals(view)).toHaveLength(0);
		expect(h.restores).toHaveLength(0);
		expect(h.files().get(src("pricing/engine.py"))).toBe("new");
	});

	test("sales-pipeline H4: build outputs a run produces are generated, not task files; scratch never counts", async () => {
		// hz11f-pursuit-r1, hz11-sales-pipeline: H1 ran build.sh (build/sales.db, out/report.txt
		// appear); H4 wrote sql/3_business_date.sql and stage3_dedupe.py, then a run rebuilt and
		// wrote 45 scratch files. v1.7 counted +1, +1, +2 (the build outputs) and fired at #15.
		const scratch = Object.fromEntries(
			Array.from({ length: 45 }, (_, i) => [
				`scratch/alt${i % 2}/f${i}.csv`,
				"s",
			]),
		);
		const h = host(
			{
				"build.sh": "b",
				"sql/3_business_date.sql": "old",
				"stage3_dedupe.py": "old",
				"input/tokyo.csv": "d",
			},
			{
				build: { "build/sales.db": "db1", "out/report.txt": "r1" },
				rebuild: {
					"build/sales.db": "db2",
					"out/report.txt": "r2",
					...scratch,
				},
			},
		);
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("run", { effect: "build" }),
					proposal("step_back"),
					call("write_file", {
						path: "sql/3_business_date.sql",
						content: "new",
					}),
					call("write_file", { path: "stage3_dedupe.py", content: "new" }),
					call("run", { effect: "rebuild" }),
					proposal("give_up"),
				],
			},
			policy: quiet("protective"),
			runtime: h.rt,
		});
		expect(scopeSignals(view)).toHaveLength(0);
		const last = view.attempts.filter((a) => a.state === "settled").at(-1)!;
		expect(last.features?.generated).toEqual([
			"build/sales.db",
			"out/report.txt",
		]);
		expect(h.restores).toHaveLength(0);
	});

	test("reaching into a new directory attempt after attempt still fires, but a protective restore does not revert on it", async () => {
		const h = host({}, {});
		const { view } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("write_file", { path: "a/x.py" }),
					call("write_file", { path: "b/x.py" }),
					call("write_file", { path: "c/x.py" }),
					call("write_file", { path: "d/x.py" }),
					proposal("give_up"),
				],
			},
			policy: quiet("protective"),
			runtime: h.rt,
		});
		expect(scopeSignals(view).length).toBeGreaterThan(0);
		expect(h.restores).toHaveLength(0);
		expect(view.decisions.some((d) => "reverted" in d.basis)).toBe(false);
	});

	test("declared targets: asked for, shown, and files inside them never widen the scope", async () => {
		const h = host({}, {});
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [{ ...hypothesis, targets: ["a/", "b", "c/x.py", "d/"] }],
				propose: [
					call("write_file", { path: "a/x.py" }),
					call("write_file", { path: "b/x.py" }),
					call("write_file", { path: "c/x.py" }),
					call("write_file", { path: "d/x.py" }),
					proposal("give_up"),
				],
			},
			policy: quiet("protective"),
			runtime: h.rt,
		});
		expect(view.hypotheses[0]!.targets).toEqual(["a/", "b", "c/x.py", "d/"]);
		expect(prompts.find((p) => p.purpose === "hypothesize")!.prompt).toContain(
			"targets には",
		);
		expect(prompts.find((p) => p.purpose === "propose")!.prompt).toContain(
			"変える対象（宣言）: a/, b, c/x.py, d/",
		);
		expect(scopeSignals(view)).toHaveLength(0);
	});

	test("a revert keeps scratch work, counts generated outputs and names only task files", async () => {
		const scratch = Object.fromEntries(
			Array.from({ length: 30 }, (_, i) => [`scratch/f${i}.txt`, "s"]),
		);
		const h = host(
			{ "src/a.py": "old" },
			{ build: { "build/out.db": "db", ...scratch } },
		);
		const { view, prompts } = await run({
			script: {
				plan: [plan],
				hypothesize: [hypothesis, hypothesis],
				propose: [
					call("write_file", { path: "src/a.py", content: "new" }),
					call("run", { effect: "build" }),
					proposal("step_back"),
					proposal("give_up"),
				],
			},
			policy: quiet("always"),
			runtime: h.rt,
		});
		const dec = view.decisions.find((d) => Array.isArray(d.basis.reverted))!;
		expect(dec.basis.reverted).toEqual(["src/a.py"]);
		expect(dec.basis.revertedGenerated).toBe(1);
		expect(dec.basis.keptScratch).toBe(30);
		expect(h.restores[0]).toEqual(["scratch", "notes", "tmp", "__pycache__"]);
		expect(h.files().get("src/a.py")).toBe("old");
		expect(h.files().has("build/out.db")).toBe(false);
		expect(h.files().get("scratch/f7.txt")).toBe("s");
		const notice = prompts.find((p) =>
			p.prompt.includes("## 作業領域の巻き戻し"),
		)!.prompt;
		expect(notice).toContain("課題のファイル（1 件）: src/a.py");
		expect(notice).toContain("生成物 1 件");
		expect(notice).toContain("30 件は戻さず");
		expect(notice).not.toContain("scratch/f7.txt");
	});
});
