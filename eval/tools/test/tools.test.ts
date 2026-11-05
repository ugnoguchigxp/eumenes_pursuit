import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countLineDiff } from "../fs-util.ts";
import { canonicalHostPath, pathsOverlap, resolveInside } from "../paths.ts";
import { clipText } from "../text.ts";
import {
	createToolPort,
	defineTool,
	ok,
	prop,
	validateInput,
} from "../tool-port.ts";

test("host path separation follows aliases and missing children, rejecting dangling links", async () => {
	const root = await mkdtemp(join(tmpdir(), "host-paths-"));
	try {
		const real = join(root, "real");
		await mkdir(real);
		await symlink(real, join(root, "alias"));
		await symlink(join(root, "missing"), join(root, "dangling"));
		const a = canonicalHostPath(join(root, "alias", "new", "child"));
		expect(a).toBe(join(canonicalHostPath(real), "new", "child"));
		expect(pathsOverlap(a, canonicalHostPath(real))).toBe(true);
		expect(pathsOverlap(canonicalHostPath(real), a)).toBe(true);
		expect(
			pathsOverlap(canonicalHostPath(real), canonicalHostPath(`${real}-other`)),
		).toBe(false);
		expect(() => canonicalHostPath(join(root, "dangling", "child"))).toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

describe("resolveInside", () => {
	test("accepts nested paths and refuses escapes and links", async () => {
		const root = await mkdtemp(join(tmpdir(), "eval-paths-"));
		try {
			await mkdir(join(root, "work", "src"), { recursive: true });
			const work = join(root, "work");
			await symlink(root, join(work, "src", "up"));
			const good = await resolveInside(work, "src/a.ts");
			expect(good).toEqual({
				ok: true,
				abs: join(work, "src", "a.ts"),
				rel: "src/a.ts",
			});
			for (const bad of [
				"..",
				"../x",
				"src/../../x",
				"/abs",
				"a\\b",
				"",
				"a\0b",
				"x".repeat(300),
			]) {
				expect((await resolveInside(work, bad)).ok).toBe(false);
			}
			const link = await resolveInside(work, "src/up/work/src/a.ts");
			expect(link.ok === false && link.errorCode).toBe("symlink_rejected");
			expect((await resolveInside(work, ".", { allowRoot: true })).ok).toBe(
				true,
			);
			await writeFile(join(root, "sibling.txt"), "x");
			expect((await resolveInside(work, "../work-evil/x")).ok).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("validateInput", () => {
	const schema = {
		type: "object",
		properties: {
			a: { type: "string", maxLength: 3 },
			n: { type: "integer", minimum: 1, maximum: 5 },
			list: { type: "array", items: { type: "string" }, maxItems: 2 },
			e: { type: "string", enum: ["x", "y"] },
		},
		required: ["a"],
		additionalProperties: false,
	};
	test("checks types, bounds, required and extras", () => {
		expect(
			validateInput(schema, { a: "abc", n: 3, list: ["q"], e: "x" }),
		).toBeNull();
		expect(validateInput(schema, {})).toContain("required");
		expect(validateInput(schema, { a: "abcd" })).toContain("too long");
		expect(validateInput(schema, { a: "a", n: 0 })).toContain(">=");
		expect(validateInput(schema, { a: "a", n: 1.5 })).toContain("integer");
		expect(validateInput(schema, { a: "a", list: ["a", "b", "c"] })).toContain(
			"too many",
		);
		expect(validateInput(schema, { a: "a", list: [1] })).toContain("string");
		expect(validateInput(schema, { a: "a", e: "z" })).toContain("one of");
		expect(validateInput(schema, { a: "a", extra: 1 })).toContain(
			"not an accepted",
		);
	});
});

describe("tool port", () => {
	const echo = defineTool(
		{
			name: "echo",
			description: "echo the text back",
			permission: "data.read",
			properties: { text: prop("string", "text") },
			required: ["text"],
		},
		async (input) => ok({ text: input.text ?? null }),
	);
	const port = createToolPort([echo]);
	test("routes, validates and honours abort", async () => {
		const live = new AbortController().signal;
		expect(
			(await port.invoke({ tool: "echo", input: { text: "hi" } }, live)).output,
		).toEqual({ text: "hi" });
		expect(
			(await port.invoke({ tool: "echo", input: {} }, live)).errorCode,
		).toBe("invalid_input");
		expect(
			(await port.invoke({ tool: "nope", input: {} }, live)).errorCode,
		).toBe("unknown_tool");
		expect(
			(
				await port.invoke(
					{ tool: "echo", input: { text: "x" } },
					AbortSignal.abort(),
				)
			).errorCode,
		).toBe("aborted");
	});
});

describe("helpers", () => {
	test("countLineDiff counts removed plus added lines", () => {
		expect(countLineDiff("", "a\nb")).toBe(2);
		expect(countLineDiff("a\nb", "")).toBe(2);
		expect(countLineDiff("a\nb\nc", "a\nB\nc")).toBe(2);
		expect(countLineDiff("a\nb\nc", "a\nb\nc")).toBe(0);
		expect(countLineDiff("a\nb\nc\nd", "a\nc\nd\ne")).toBe(2);
	});
	test("clipText says when it truncates", () => {
		expect(clipText("abc", 5)).toBe("abc");
		expect(clipText("abcdef", 3)).toContain("truncated: 3 more chars");
	});
});
