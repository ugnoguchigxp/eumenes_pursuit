// Eumenes writeLocal body; injected scratch implementation and URI.
import { documentName } from "./document-name.ts";
type Input = {
	id: string;
	conversationId: string;
	title: string;
	markdown: string;
};
type Item = {
	id: string;
	conversationId: string;
	name: string;
	mime: string;
	data: Uint8Array;
	origin: string;
	maker: string;
};
export function localMarkdown(
	scratch: { put(item: Item): Promise<{ id: string }> },
	scratchUri: (id: string) => string,
) {
	return {
		async writeLocal(input: Input, signal: AbortSignal) {
			signal.throwIfAborted();
			if (!scratch) throw new Error("scratch_unavailable");
			const item = await scratch.put({
				id: input.id,
				conversationId: input.conversationId,
				name: `${documentName(input.title)}.md`,
				mime: "text/markdown",
				data: new TextEncoder().encode(input.markdown),
				origin: "written",
				maker: "詳しいWeb調査",
			});
			return scratchUri(item.id);
		},
	};
}
