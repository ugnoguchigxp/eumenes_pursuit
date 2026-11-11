import { expect, test } from "bun:test";
import { displayedExcerpt } from "../source-excerpt.ts";

const source = {
	id: "e2",
	version: "a".repeat(64),
	start: 100,
	storedLength: 30000,
	sourceTruncated: false,
};

test.each([8000, 1800])(
	"excerpt reports the exact shown and returned ranges at limit %i",
	(limit) => {
		const text = '資料"\\\n😀'.repeat(1500);
		const shown = displayedExcerpt({ text }, source, limit)!;
		expect(JSON.stringify(shown).length).toBeLessThanOrEqual(limit);
		expect(shown.source).toMatchObject({
			id: source.id,
			version: source.version,
			storedLength: source.storedLength,
			returnedRange: { start: 100, end: 100 + text.length },
			shownRange: { start: 100, end: 100 + shown.text.length },
			sourceTruncated: false,
		});
		expect(shown.text).toBe(text.slice(0, shown.text.length));
		expect(shown.text.length).toBeLessThan(text.length);
		expect(shown.text).not.toMatch(/[\uD800-\uDBFF]$/);
	},
);

test("a fully shown excerpt can come from a truncated saved source", () => {
	expect(
		displayedExcerpt(
			{ text: "本文" },
			{ ...source, sourceTruncated: true, matchIndex: 101 },
			1800,
		),
	).toEqual({
		source: {
			id: source.id,
			version: source.version,
			storedLength: source.storedLength,
			sourceTruncated: true,
			matchIndex: 101,
			returnedRange: { start: 100, end: 102 },
			shownRange: { start: 100, end: 102 },
		},
		text: "本文",
	});
});

test("an empty read and a search miss have distinct ranges", () => {
	expect(
		displayedExcerpt({ text: "" }, source, 1800)?.source.shownRange,
	).toEqual({ start: 100, end: 100 });
	expect(
		displayedExcerpt(
			{ text: "" },
			{ ...source, start: null, matchIndex: null },
			1800,
		)?.source,
	).toMatchObject({ returnedRange: null, shownRange: null, matchIndex: null });
});

test("coordinates survive a tiny budget; legacy and invalid results fall back", () => {
	expect(displayedExcerpt({ text: "本文" }, source, 1)).toMatchObject({
		source: { id: "e2", shownRange: { start: 100, end: 100 } },
		text: "",
	});
	expect(displayedExcerpt({ text: "本文" }, undefined, 1000)).toBeUndefined();
	expect(
		displayedExcerpt({ text: "本文" }, { ...source, storedLength: 101 }, 1000),
	).toBeUndefined();
});
