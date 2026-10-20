/**
 * The shipped core (src/) stays host-neutral: no clocks, randomness, timers,
 * network, filesystem or process; no imports of standalone/ or eval/; domains
 * import only their declared dependencies. Static guard, not a sandbox.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { domains, isDomain } from "./domains.ts";

const root = resolve(import.meta.dir, "../src");
const banned = new Set([
	"Bun",
	"process",
	"Date",
	"performance",
	"crypto",
	"fetch",
	"setTimeout",
	"setInterval",
	"setImmediate",
	"WebSocket",
	"XMLHttpRequest",
	"globalThis",
	"Math",
]);
const allowedMath = new Set(["round", "max", "min", "floor", "ceil", "abs"]);
const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? walk(resolve(dir, e.name))
			: e.name.endsWith(".ts")
				? [resolve(dir, e.name)]
				: [],
	);
const owner = (file: string) =>
	/^domains\/([^/]+)\//.exec(relative(root, file))?.[1];
const errors: string[] = [];
for (const file of walk(root)) {
	const name = relative(root, file);
	const test = name.endsWith(".test.ts") || name.includes("/test/");
	const domain = owner(file);
	if (domain && !isDomain(domain)) errors.push(`${name}: unregistered domain`);
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const visit = (node: ts.Node) => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			const spec = node.moduleSpecifier.text;
			if (!test && (spec.startsWith("node:") || spec.startsWith("bun:")))
				errors.push(`${name}: host module ${spec}`);
			if (spec.startsWith(".")) {
				const target = resolve(dirname(file), spec);
				const rel = relative(root, target);
				if (rel.startsWith("..") && !test)
					errors.push(`${name}: imports outside src (${spec})`);
				const other = owner(target);
				if (
					!test &&
					domain &&
					other &&
					other !== domain &&
					!(
						domains[domain as keyof typeof domains].depends as readonly string[]
					).includes(other)
				)
					errors.push(`${name}: undeclared dependency ${domain} -> ${other}`);
			} else if (!test && spec !== "zod")
				errors.push(`${name}: external module ${spec}`);
		}
		if (!test && ts.isIdentifier(node) && banned.has(node.text)) {
			const parent = node.parent;
			const isMember =
				ts.isPropertyAccessExpression(parent) && parent.name === node;
			const isKey =
				(ts.isPropertyAssignment(parent) ||
					ts.isPropertySignature(parent) ||
					ts.isMethodSignature(parent)) &&
				parent.name === node;
			const mathOk =
				node.text === "Math" &&
				ts.isPropertyAccessExpression(parent) &&
				allowedMath.has(parent.name.text);
			if (!isMember && !isKey && !mathOk && !ts.isImportSpecifier(parent))
				errors.push(
					`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ambient ${node.text}`,
				);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}
if (errors.length) {
	console.error(errors.join("\n"));
	process.exit(1);
}
console.log(
	"OK: core is host-neutral; domain dependencies match scripts/domains.ts",
);
