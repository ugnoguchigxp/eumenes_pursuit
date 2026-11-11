import type { JsonValue, SourceExcerpt } from "../../contracts/index.ts";

export function displayedExcerpt(
	output: JsonValue,
	excerpt: SourceExcerpt | undefined,
	limit: number,
) {
	if (
		!excerpt ||
		!output ||
		typeof output !== "object" ||
		Array.isArray(output) ||
		typeof output.text !== "string"
	)
		return undefined;
	const { text } = output;
	const { start, storedLength } = excerpt;
	if (
		start === null
			? text.length !== 0
			: !Number.isSafeInteger(start) ||
				start < 0 ||
				start + text.length > storedLength
	)
		return undefined;
	const range = (length: number) =>
		start === null ? null : { start, end: start + length };
	const source = {
		id: excerpt.id,
		version: excerpt.version,
		storedLength,
		sourceTruncated: excerpt.sourceTruncated,
		returnedRange: range(text.length),
		...(excerpt.matchIndex === undefined
			? {}
			: { matchIndex: excerpt.matchIndex }),
	};
	const packet = (body: string) => ({
		source: { ...source, shownRange: range(body.length) },
		text: body,
	});
	const full = packet(text);
	if (JSON.stringify(full).length <= limit) return full;

	// Keep coordinates visible even if the configured budget cannot fit the metadata alone.
	let lower = 0;
	let upper = Math.min(text.length, limit);
	while (lower < upper) {
		const mid = Math.ceil((lower + upper) / 2);
		if (JSON.stringify(packet(text.slice(0, mid))).length <= limit) lower = mid;
		else upper = mid - 1;
	}
	// Clipping may occur at a UTF-16 surrogate boundary; keep only complete characters.
	const last = text.charCodeAt(lower - 1);
	if (lower < text.length && last >= 0xd800 && last <= 0xdbff) lower--;
	return packet(text.slice(0, lower));
}
