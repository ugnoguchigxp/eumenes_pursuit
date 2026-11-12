import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockCampaign, openCampaign, publishCandidate } from "./run-state.ts";

test("campaign state and exclusive ownership survive a killed process", async () => {
	const directory = await mkdtemp(join(tmpdir(), "optimizer-campaign-"));
	const root = JSON.stringify(directory);
	const helper = JSON.stringify(
		new URL("./run-state.ts", import.meta.url).pathname,
	);
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`
		import { lockCampaign, openCampaign } from ${helper};
		lockCampaign(${root});
		console.log(await openCampaign(${root}, "protocol", false));
		await Bun.sleep(60000);
	`,
		],
		{ stdout: "pipe" },
	);
	try {
		const reader = child.stdout.getReader();
		const { value } = await reader.read();
		const id = new TextDecoder().decode(value).trim();
		expect(id).toHaveLength(36);
		expect(() => lockCampaign(directory)).toThrow(
			"optimizer_campaign_lock_failed",
		);
		child.kill("SIGKILL");
		await child.exited;
		const unlock = lockCampaign(directory);
		try {
			expect(await openCampaign(directory, "protocol", true)).toBe(id);
			await expect(openCampaign(directory, "different", true)).rejects.toThrow(
				"optimizer_resume_protocol_mismatch",
			);
		} finally {
			unlock();
		}
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		await child.exited;
		await rm(directory, { recursive: true, force: true });
	}
});

test("publication retries preserve the previously published bytes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "optimizer-publication-"));
	try {
		const path = join(directory, "windowsum.py");
		await publishCandidate(path, "verified");
		await publishCandidate(path, "verified");
		await expect(publishCandidate(path, "other")).rejects.toThrow(
			"optimizer_publication_conflict",
		);
		expect(await readFile(path, "utf8")).toBe("verified");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
