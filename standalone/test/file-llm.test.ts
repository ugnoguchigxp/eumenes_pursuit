import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LlmOutputError } from "../../src/contracts/index.ts";
import { createFileLlm } from "../file-llm.ts";

const schema = z.strictObject({ answer: z.string().min(1) });
const request = {
	purpose: "plan" as const,
	system: "sys",
	prompt: "prompt",
	schema,
	maxOutputTokens: 100,
};

async function waitForRequest(dir: string, count = 1): Promise<string> {
	for (let i = 0; i < 400; i++) {
		// Retries (<id>-retry<k>) come after their original.
		const files = readdirSync(join(dir, "requests")).sort(
			(a, b) => a.length - b.length || a.localeCompare(b),
		);
		if (files.length >= count)
			return files.at(count - 1)!.replace(/\.json$/, "");
		await Bun.sleep(5);
	}
	throw new Error("no_request");
}

describe("file LLM port", () => {
	test("writes the request with a JSON schema and returns the parsed response", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({ dir, role: "generator", pollMs: 5 });
		const pending = llm.complete(request, AbortSignal.timeout(5000));
		const id = await waitForRequest(dir);
		const written = JSON.parse(
			readFileSync(join(dir, "requests", `${id}.json`), "utf8"),
		);
		expect(written).toMatchObject({
			role: "generator",
			purpose: "plan",
			system: "sys",
			prompt: "prompt",
		});
		expect(written.outputSchema.required).toEqual(["answer"]);
		writeFileSync(
			join(dir, "responses", `${id}.json`),
			JSON.stringify({ answer: "ok" }),
		);
		const result = await pending;
		expect(result.value).toEqual({ answer: "ok" });
		expect(result.model).toBe("file:generator");
	});

	test("an unknown key is rejected and re-requested; a valid retry answer is returned", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({ dir, role: "generator", pollMs: 5 });
		const pending = llm.complete(request, AbortSignal.timeout(5000));
		const first = await waitForRequest(dir);
		writeFileSync(
			join(dir, "responses", `${first}.json`),
			JSON.stringify({ answer: "ok", extra: 1 }),
		);
		const retry = await waitForRequest(dir, 2);
		expect(retry).toBe(`${first}-retry1`);
		const written = JSON.parse(
			readFileSync(join(dir, "requests", `${retry}.json`), "utf8"),
		);
		expect(written.retryOf).toBe(first);
		expect(JSON.stringify(written.previousError)).toContain("extra");
		expect(written.prompt).toBe("prompt");
		expect(existsSync(join(dir, "responses", `${first}.error.txt`))).toBe(true);
		writeFileSync(
			join(dir, "responses", `${retry}.json`),
			JSON.stringify({ answer: "fixed" }),
		);
		expect((await pending).value).toEqual({ answer: "fixed" });
	});

	test("invalid JSON is re-requested too", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({ dir, role: "grader", pollMs: 5 });
		const pending = llm.complete(request, AbortSignal.timeout(5000));
		const first = await waitForRequest(dir);
		writeFileSync(join(dir, "responses", `${first}.json`), "{not json");
		const retry = await waitForRequest(dir, 2);
		writeFileSync(
			join(dir, "responses", `${retry}.json`),
			JSON.stringify({ answer: "ok" }),
		);
		expect((await pending).value).toEqual({ answer: "ok" });
	});

	test("after maxRetries invalid responses the call fails with LlmOutputError", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({
			dir,
			role: "reviewer",
			pollMs: 5,
			maxRetries: 1,
		});
		const pending = llm.complete(request, AbortSignal.timeout(5000));
		for (const n of [1, 2]) {
			const id = await waitForRequest(dir, n);
			writeFileSync(
				join(dir, "responses", `${id}.json`),
				JSON.stringify({ answer: "" }),
			);
		}
		const error = await pending.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LlmOutputError);
		expect((error as LlmOutputError).reasonCode).toBe("schema");
		expect(readdirSync(join(dir, "requests"))).toHaveLength(2);
	});

	test("with maxRetries 0 a response outside the schema is an LlmOutputError with the issues kept", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({
			dir,
			role: "reviewer",
			pollMs: 5,
			maxRetries: 0,
		});
		const pending = llm.complete(request, AbortSignal.timeout(5000));
		const id = await waitForRequest(dir);
		writeFileSync(
			join(dir, "responses", `${id}.json`),
			JSON.stringify({ answer: "" }),
		);
		const error = await pending.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LlmOutputError);
		expect((error as LlmOutputError).reasonCode).toBe("schema");
		expect(existsSync(join(dir, "responses", `${id}.error.txt`))).toBe(true);
	});

	test("an abort stops the wait", async () => {
		const dir = mkdtempSync(join(tmpdir(), "file-llm-"));
		const llm = createFileLlm({ dir, role: "generator", pollMs: 5 });
		const controller = new AbortController();
		const pending = llm.complete(request, controller.signal);
		await waitForRequest(dir);
		controller.abort();
		await expect(pending).rejects.toThrow("aborted");
	});
});
