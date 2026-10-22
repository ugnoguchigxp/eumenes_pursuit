/**
 * Run artifacts must not reach the repository by accident. Fails when a tracked or staged path is
 * a run artifact outside the published set: under eval/results/ only eval/results/PUBLISHED and
 * runs.jsonl / summary.md / analysis.md of the runs it names are allowed; anywhere, ledger and
 * usage databases (*.sqlite, *.db and their -wal / -shm / -journal files) are never allowed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RESULTS = "eval/results/";
const PUBLISHED_FILES = new Set(["runs.jsonl", "summary.md", "analysis.md"]);
const DATABASE = /\.(sqlite3?|db)(-wal|-shm|-journal)?$/;

/** Run names listed in eval/results/PUBLISHED (one per line; # starts a comment). */
export function parsePublished(text: string): Set<string> {
	return new Set(
		text
			.split("\n")
			.map((l) => l.replace(/#.*/, "").trim())
			.filter(Boolean),
	);
}

/** The paths that break the rule, each with the reason. */
export function resultViolations(
	paths: readonly string[],
	published: ReadonlySet<string>,
): string[] {
	const out: string[] = [];
	for (const path of paths) {
		if (DATABASE.test(path)) {
			out.push(`${path}: database file (ledger / usage stay local)`);
			continue;
		}
		if (!path.startsWith(RESULTS) || path === `${RESULTS}PUBLISHED`) continue;
		const [run, file, ...rest] = path.slice(RESULTS.length).split("/");
		if (!run || !published.has(run))
			out.push(`${path}: run "${run}" is not in ${RESULTS}PUBLISHED`);
		else if (rest.length || !file || !PUBLISHED_FILES.has(file))
			out.push(
				`${path}: only runs.jsonl, summary.md and analysis.md of a published run are kept`,
			);
	}
	return out;
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	// The index: tracked files plus anything staged for the next commit.
	const git = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root });
	if (git.exitCode !== 0) {
		console.log("check-results: not a git work tree, skipped");
		process.exit(0);
	}
	const paths = git.stdout.toString().split("\0").filter(Boolean);
	const published = parsePublished(
		readFileSync(resolve(root, RESULTS, "PUBLISHED"), "utf8"),
	);
	const bad = resultViolations(paths, published);
	if (bad.length) {
		console.error(
			`Run artifacts are tracked or staged outside the published set:\n${bad.map((b) => `  ${b}`).join("\n")}\nUnstage them (git rm --cached <path>) or publish the run in ${RESULTS}PUBLISHED.`,
		);
		process.exit(1);
	}
	console.log(`check-results: OK (${published.size} published runs)`);
}
