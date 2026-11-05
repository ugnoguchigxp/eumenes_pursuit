import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../fixtures/crash-runner.ts";
for (const [stage, exit] of [
	["before", 91],
	["after", 92],
	["post", 93],
	["acceptance", 94],
] as const)
	test(`a real process crash at ${stage} preserves ledger facts and avoids replaying effects`, async () => {
		const dir = await mkdtemp(join(tmpdir(), "pursuit-crash-"));
		const db = join(dir, "ledger.sqlite"),
			marker = join(dir, "effects");
		try {
			const proc = Bun.spawn(
				[
					process.execPath,
					new URL("../fixtures/crash-runner.ts", import.meta.url).pathname,
					db,
					marker,
					stage,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const id = (await new Response(proc.stdout).text()).trim();
			expect(await proc.exited).toBe(exit);
			const f = fixture(db, marker, null);
			try {
				const before = (await f.engine.view(id))!;
				expect(before.attempts).toHaveLength(1);
				const result = await f.engine.step(
					id,
					f.runtime,
					AbortSignal.timeout(1000),
				);
				if (stage === "before" || stage === "after") {
					expect(result.event).toBe("interrupted");
					expect((await f.engine.view(id))!.attempts[0]?.outcome).toBeNull();
					expect(
						(await f.engine.step(id, f.runtime, AbortSignal.timeout(1000)))
							.event,
					).toBe("rejected");
				} else {
					expect(
						(await f.engine.view(id))!.attempts[0]?.settlement?.stage,
					).toBe("done");
					expect((await f.engine.view(id))!.verifications).toHaveLength(1);
				}
				const effects = await readFile(marker, "utf8").catch(() => "");
				expect(effects).toBe(stage === "before" ? "" : "effect\n");
			} finally {
				f.store.close();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
