import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSettings } from "../settings.ts";

// Two runner processes share the settings/usage database (e.g. a pursuit run and a direct run
// started side by side). A writer that finds the database locked waits instead of failing.
test("a second process waits for the settings lock instead of failing with SQLITE_BUSY", async () => {
	const dir = mkdtempSync(join(tmpdir(), "settings-lock-"));
	const path = join(dir, "settings.sqlite");
	try {
		openSettings(path).close();
		const holder = Bun.spawn(
			[
				process.execPath,
				"-e",
				`const { Database } = require("bun:sqlite");
				 const db = new Database(${JSON.stringify(path)});
				 db.exec("BEGIN IMMEDIATE");
				 console.log("locked");
				 Bun.sleepSync(400);
				 db.exec("COMMIT");`,
			],
			{ stdout: "pipe" },
		);
		const reader = holder.stdout.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("locked");
		const s = openSettings(path);
		s.set("spend.limitUsd", 3);
		expect(s.get("spend.limitUsd")).toBe(3);
		s.close();
		await holder.exited;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
