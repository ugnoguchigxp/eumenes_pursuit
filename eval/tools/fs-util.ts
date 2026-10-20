import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Regular files under `root`, relative posix paths, sorted. */
export async function listFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string, prefix: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
			else if (entry.isFile()) found.push(rel);
		}
	}
	await walk(root, "");
	return found.sort();
}

export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function resetDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
}

/** Replaces `to` with a copy of `from`. */
export async function replaceTree(from: string, to: string): Promise<void> {
	await rm(to, { recursive: true, force: true });
	await mkdir(to, { recursive: true });
	await cp(from, to, { recursive: true });
}

export async function digestTree(root: string): Promise<string> {
	const hash = createHash("sha256");
	for (const rel of await listFiles(root)) {
		const content = await readFile(join(root, rel));
		hash.update(`${rel}\0${content.length}\0`);
		hash.update(content);
	}
	return hash.digest("hex");
}

function toLines(text: string): string[] {
	return text === "" ? [] : text.split("\n");
}

/** Lines removed plus lines added; order-only moves are cheap to miss. */
export function countLineDiff(before: string, after: string): number {
	const a = toLines(before);
	const b = toLines(after);
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start += 1;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA -= 1;
		endB -= 1;
	}
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	if (midA.length === 0 || midB.length === 0) return midA.length + midB.length;
	let common: number;
	if (midA.length * midB.length <= 4_000_000) {
		let previous = new Uint32Array(midB.length + 1);
		for (const lineA of midA) {
			const row = new Uint32Array(midB.length + 1);
			for (let j = 1; j <= midB.length; j += 1) {
				row[j] =
					lineA === midB[j - 1]
						? (previous[j - 1] ?? 0) + 1
						: Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
			}
			previous = row;
		}
		common = previous[midB.length] ?? 0;
	} else {
		const counts = new Map<string, number>();
		for (const line of midA) counts.set(line, (counts.get(line) ?? 0) + 1);
		common = 0;
		for (const line of midB) {
			const left = counts.get(line) ?? 0;
			if (left > 0) {
				counts.set(line, left - 1);
				common += 1;
			}
		}
	}
	return midA.length - common + (midB.length - common);
}
