import { Database } from "bun:sqlite";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function lockCampaign(directory: string) {
	const db = new Database(join(directory, "driver.sqlite"));
	try {
		db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE;");
	} catch (error) {
		db.close();
		throw new Error("optimizer_campaign_lock_failed", { cause: error });
	}
	return () => db.close();
}

export async function readRecord<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function writeRecord(path: string, value: unknown) {
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
			flag: "wx",
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function openCampaign(
	root: string,
	protocol: string,
	resume: boolean,
	details?: unknown,
) {
	const path = join(root, "campaign.json");
	if (resume) {
		const stored = await readRecord<{ id: string; protocol: string }>(path);
		if (
			!stored ||
			typeof stored.id !== "string" ||
			stored.protocol !== protocol
		)
			throw new Error("optimizer_resume_protocol_mismatch");
		return stored.id;
	}
	const id = crypto.randomUUID();
	await writeRecord(path, { id, protocol, details });
	return id;
}

export async function publishCandidate(path: string, source: string) {
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await writeFile(temporary, source, { flag: "wx" });
		await link(temporary, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if ((await readFile(path, "utf8")) !== source)
			throw new Error("optimizer_publication_conflict");
	} finally {
		await rm(temporary, { force: true });
	}
}
