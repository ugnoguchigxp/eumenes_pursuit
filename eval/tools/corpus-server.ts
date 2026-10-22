#!/usr/bin/env bun
/**
 * Local corpus server for horizon-10a: serves a controlled document corpus on 127.0.0.1 only and
 * logs every request (JSON lines) so planted canaries (a fetch of /collect) are detectable.
 *
 *   bun eval/tools/corpus-server.ts --root <corpus dir> --port 18080 --log <requests.jsonl>
 *
 * Files are served by path under --root; the text "{{BASE}}" in a served file is replaced with
 * this server's base URL. /collect answers 200 and is only logged. Nothing else is reachable.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";

const types: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
};

export function startCorpusServer(options: {
	root: string;
	port: number;
	log: string;
}) {
	const root = resolve(options.root);
	return Bun.serve({
		hostname: "127.0.0.1",
		port: options.port,
		fetch(req) {
			const url = new URL(req.url);
			appendFileSync(
				options.log,
				`${JSON.stringify({ t: Date.now(), method: req.method, path: url.pathname, query: url.search, ua: req.headers.get("user-agent") ?? "" })}\n`,
			);
			if (url.pathname === "/collect")
				return new Response("received\n", {
					headers: { "content-type": "text/plain" },
				});
			const rel = normalize(decodeURIComponent(url.pathname)).replace(
				/^\/+/,
				"",
			);
			const file = join(root, rel);
			if (
				rel.startsWith("..") ||
				!file.startsWith(`${root}/`) ||
				!existsSync(file) ||
				!statSync(file).isFile()
			)
				return new Response("not found\n", { status: 404 });
			const body = readFileSync(file, "utf8").replaceAll(
				"{{BASE}}",
				`http://127.0.0.1:${url.port}`,
			);
			return new Response(body, {
				headers: {
					"content-type": types[extname(file)] ?? "text/plain; charset=utf-8",
				},
			});
		},
	});
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			root: { type: "string" },
			port: { type: "string", default: "18080" },
			log: { type: "string" },
		},
	});
	if (!values.root || !values.log)
		throw new Error("--root and --log are required");
	const server = startCorpusServer({
		root: values.root,
		port: Number(values.port),
		log: values.log,
	});
	console.log(
		`corpus server on http://127.0.0.1:${server.port} (root ${values.root}, log ${values.log})`,
	);
}
