import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	WorkspaceChanges,
	WorkspacePort,
} from "../../src/contracts/index.ts";
import {
	countLineDiff,
	digestTree,
	listFiles,
	replaceTree,
} from "./fs-util.ts";

export function isTestPath(rel: string): boolean {
	return rel.startsWith("test/") || rel.endsWith(".test.ts");
}

export interface DirWorkspaceOptions {
	readonly directory: string;
	readonly workDir: string;
	/** Paths whose change counts as touching acceptance checks or tests. */
	readonly isProtected?: (rel: string) => boolean;
}

async function readText(path: string): Promise<string> {
	return (await readFile(path)).toString("utf8");
}

/** Checkpoints are plain copies of `workDir` under `<directory>/checkpoints/<n>`. */
export function createDirWorkspace(
	options: DirWorkspaceOptions,
): WorkspacePort {
	const { directory, workDir } = options;
	const isProtected = options.isProtected ?? (() => false);
	const root = join(directory, "checkpoints");

	function checkpointDir(id: string): string {
		if (!/^[1-9][0-9]{0,8}$/.test(id)) throw new Error(`bad checkpoint: ${id}`);
		return join(root, id);
	}

	return {
		async checkpoint() {
			await mkdir(root, { recursive: true });
			const taken = (await readdir(root)).map(Number).filter(Number.isInteger);
			const id = String(Math.max(0, ...taken) + 1);
			await replaceTree(workDir, checkpointDir(id));
			return id;
		},
		async restore(checkpoint, keep) {
			// keep.dirs (v1.8): files with such a path segment stay exactly as they are now.
			const kept = (rel: string) =>
				!!keep && rel.split("/").some((s) => keep.dirs.includes(s));
			const saved = new Map<string, Buffer>();
			if (keep)
				for (const rel of await listFiles(workDir))
					if (kept(rel)) saved.set(rel, await readFile(join(workDir, rel)));
			await replaceTree(checkpointDir(checkpoint), workDir);
			if (!keep) return;
			for (const rel of await listFiles(workDir))
				if (kept(rel) && !saved.has(rel))
					await rm(join(workDir, rel), { force: true });
			for (const [rel, bytes] of saved) {
				await mkdir(dirname(join(workDir, rel)), { recursive: true });
				await writeFile(join(workDir, rel), bytes);
			}
		},
		digest: () => digestTree(workDir),
		async changesSince(checkpoint): Promise<WorkspaceChanges> {
			const base = checkpointDir(checkpoint);
			const before = new Set(await listFiles(base));
			const after = new Set(await listFiles(workDir));
			const touched: string[] = [];
			let lines = 0;
			for (const rel of [...new Set([...before, ...after])].sort()) {
				const oldText = before.has(rel) ? await readText(join(base, rel)) : "";
				const newText = after.has(rel)
					? await readText(join(workDir, rel))
					: "";
				if (before.has(rel) && after.has(rel) && oldText === newText) continue;
				touched.push(rel);
				lines += countLineDiff(oldText, newText);
			}
			return {
				filesTouched: touched,
				linesChanged: lines,
				// Adding a new test is legitimate; changing or deleting an existing check is not.
				protectedTouched: touched.filter(
					(rel) => before.has(rel) && isProtected(rel),
				),
				filesCreated: touched.filter((rel) => !before.has(rel)),
			};
		},
	};
}
