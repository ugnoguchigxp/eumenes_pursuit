/** Copy source-owned research tool contracts; never reads production settings or databases. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const source = process.argv[2];
if (!source)
	throw new Error("Usage: bun examples/eumenes/sync.ts /path/to/eumenes");
const root = resolve(source),
	out = import.meta.dir;
mkdirSync(join(out, "source-snapshot"), { recursive: true });
const hash = (s: string) =>
	new Bun.CryptoHasher("sha256").update(s).digest("hex");
const sources: Record<
	string,
	{ source: string; sha256: string; adaptations: string }
> = {};
for (const [file, dest] of [
	["api/domains/pursuit/service/tools.ts", "tools.ts"],
	["api/domains/pursuit/service/acceptance.ts", "acceptance.ts"],
]) {
	const original = readFileSync(join(root, file!), "utf8");
	writeFileSync(join(out, "source-snapshot", dest! + ".txt"), original);
	const code = original
		.replaceAll('"eumenes-pursuit"', '"../../src/index.ts"')
		.replaceAll('"eumenes-pursuit/sqlite"', '"../../src/sqlite.ts"')
		.replaceAll('"../../capabilities"', '"./hash.ts"')
		.replaceAll('"../contracts"', '"./contracts.ts"')
		.replaceAll('"../repository"', '"./repository.ts"')
		.replaceAll('"./context"', '"./context.ts"')
		.replaceAll('"./model"', '"./model.ts"')
		.replaceAll('"./tools"', '"./tools.ts"');
	writeFileSync(
		join(out, dest!),
		"// Copied from Eumenes; import paths adapted only. See provenance.json.\n" +
			code,
	);
	sources[dest!] = {
		source: file!,
		sha256: hash(original),
		adaptations:
			"Import bindings only; function bodies and validation preserved",
	};
}
const file = "api/domains/pursuit/contracts/index.ts",
	original = readFileSync(join(root, file), "utf8");
writeFileSync(join(out, "source-snapshot", "contracts.ts.txt"), original);
const body = original.slice(
	original.indexOf("export const researchDraft"),
	original.indexOf("export interface ResearchDocumentPort"),
);
writeFileSync(
	join(out, "contracts.ts"),
	'// Copied Eumenes research schemas without modification.\nimport {z} from "zod";\n' +
		body,
);
sources["contracts.ts"] = {
	source: file,
	sha256: hash(original),
	adaptations:
		"Only researchDraft/researchDocumentDraft/ResearchDraft declarations extracted",
};
const bundleFile =
		"api/domains/capabilities/bundles/pursuit-research.bundle.json",
	bundleText = readFileSync(join(root, bundleFile), "utf8"),
	bundle = JSON.parse(bundleText);
const skills = bundle.definitions
	.filter(
		(d: { kind: string; id: string }) =>
			d.kind === "skill" && d.id === "pursuit.research",
	)
	.sort(
		(a: { revision: number }, b: { revision: number }) =>
			b.revision - a.revision,
	);
const skill = skills[0];
if (!skill?.body) throw new Error("pursuit skill body missing");
writeFileSync(
	join(out, "instructions.json"),
	JSON.stringify(
		{ id: skill.id, revision: skill.revision, body: skill.body },
		null,
		2,
	) + "\n",
);
sources["instructions.json"] = {
	source: bundleFile,
	sha256: hash(bundleText),
	adaptations:
		"Highest source skill revision; frozen at sync time, not assumed to match historical runs",
};
const additions = [
	["api/domains/pursuit/service/policy.json", "policy.json", null],
	[
		"api/domains/pursuit/service/documents.ts",
		"document-name.ts",
		["export function documentName", "export function publishDocument"],
	],
	[
		"api/application/pursuit/document-port.ts",
		"markdown-write.ts",
		["async writeLocal", "hasLocal:"],
	],
] as const;
for (const [file, dest, markers] of additions) {
	const original = readFileSync(join(root, file), "utf8");
	writeFileSync(join(out, "source-snapshot", dest + ".txt"), original);
	const code = markers
		? original.slice(original.indexOf(markers[0]), original.indexOf(markers[1]))
		: original;
	if (dest === "markdown-write.ts") {
		writeFileSync(
			join(out, dest),
			`// Eumenes writeLocal body; injected scratch implementation and URI.
import { documentName } from "./document-name.ts";
type Input = { id: string; conversationId: string; title: string; markdown: string };
type Item = { id: string; conversationId: string; name: string; mime: string; data: Uint8Array; origin: string; maker: string };
export function localMarkdown(scratch: { put(item: Item): Promise<{id:string}> }, scratchUri: (id:string)=>string) {
	return {
		${code.replace("writeLocal(input, signal)", "writeLocal(input: Input, signal: AbortSignal)").trim()}
	};
}
`,
		);
	} else writeFileSync(join(out, dest), code);
	sources[dest] = {
		source: file,
		sha256: hash(original),
		adaptations:
			dest === "markdown-write.ts"
				? "Extracted writeLocal, inject scratch.put and URI; do not use production scratch"
				: markers
					? "Filename function extracted"
					: "Copied policy verbatim",
	};
}
const commit = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"], {
	stdout: "pipe",
});
writeFileSync(
	join(out, "provenance.json"),
	JSON.stringify(
		{ sourceBaseCommit: commit.stdout.toString().trim(), sources },
		null,
		2,
	) + "\n",
);
console.log(
	"Copied Eumenes tools, schemas, acceptance and source skill; no product state accessed.",
);
