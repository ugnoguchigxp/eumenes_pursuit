import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDirWorkspace } from "../workspace.ts";

async function put(root: string, rel: string, text: string) {
	await mkdir(dirname(join(root, rel)), { recursive: true });
	await writeFile(join(root, rel), text);
}
const exists = (p: string) =>
	readFile(p).then(
		() => true,
		() => false,
	);

describe("directory workspace v1.8 (spec/fixes-2026-10-22-b.md §1)", () => {
	test("filesCreated, and restore keeping scratch directories exactly as they are", async () => {
		const base = await mkdtemp(join(tmpdir(), "ws-"));
		try {
			const work = join(base, "work");
			await put(work, "src/a.py", "old");
			await put(work, "scratch/old.txt", "s0");
			const ws = createDirWorkspace({
				directory: join(base, "state"),
				workDir: work,
			});
			const cp = await ws.checkpoint();
			await put(work, "src/a.py", "new");
			await put(work, "build/out.db", "db");
			await put(work, "scratch/new.txt", "s1");
			await put(work, "scratch/old.txt", "s0b");
			await rm(join(work, "scratch/old.txt"));
			const changes = await ws.changesSince(cp);
			expect(changes.filesTouched).toEqual([
				"build/out.db",
				"scratch/new.txt",
				"scratch/old.txt",
				"src/a.py",
			]);
			expect(changes.filesCreated).toEqual(["build/out.db", "scratch/new.txt"]);
			await ws.restore(cp, { dirs: ["scratch"] });
			expect(await readFile(join(work, "src/a.py"), "utf8")).toBe("old");
			expect(await exists(join(work, "build/out.db"))).toBe(false);
			expect(await readFile(join(work, "scratch/new.txt"), "utf8")).toBe("s1");
			// Deleted scratch work stays deleted: kept means "as it is now".
			expect(await exists(join(work, "scratch/old.txt"))).toBe(false);
			await ws.restore(cp);
			expect(await readFile(join(work, "scratch/old.txt"), "utf8")).toBe("s0");
			expect(await exists(join(work, "scratch/new.txt"))).toBe(false);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});
