import {
	mkdtemp,
	mkdir,
	readFile,
	writeFile,
	cp,
	rm,
	readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
export async function files(rootDir: string, prefix = ""): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(join(rootDir, prefix), {
		withFileTypes: true,
	})) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) throw new Error("package_symlink");
		if (entry.isDirectory()) out.push(...(await files(rootDir, name)));
		else if (entry.isFile()) out.push(name);
	}
	return out.sort();
}
export async function verifyPackage(dir: string) {
	const manifest = JSON.parse(
		await readFile(join(dir, "MANIFEST.json"), "utf8"),
	) as { files: Record<string, string> };
	const actual = (await files(dir)).filter((p) => p !== "MANIFEST.json");
	if (
		JSON.stringify(actual) !==
		JSON.stringify(Object.keys(manifest.files).sort())
	)
		throw new Error("package_file_set");
	for (const path of actual) {
		const hash = new Bun.CryptoHasher("sha256")
			.update(await readFile(join(dir, path)))
			.digest("hex");
		if (hash !== manifest.files[path])
			throw new Error(`package_checksum:${path}`);
	}
}
if (import.meta.main) {
	const output = resolve(
		process.argv[2] ?? join(root, "artifacts/eumenes-pursuit.tgz"),
	);
	const stage = await mkdtemp(join(tmpdir(), "pursuit-pack-"));
	try {
		const dir = join(stage, "package");
		await mkdir(dir);
		const build = Bun.spawn(
			[
				join(root, "node_modules/.bin/tsc"),
				"-p",
				join(root, "tsconfig.build.json"),
				"--outDir",
				join(dir, "dist"),
				"--sourceMap",
				"false",
				"--declarationMap",
				"false",
			],
			{ cwd: root, stdout: "inherit", stderr: "inherit" },
		);
		if ((await build.exited) !== 0) throw new Error("package_build_failed");
		const source = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		);
		const pkg = {
			name: source.name,
			version: source.version,
			type: "module",
			license: source.license,
			sideEffects: false,
			exports: {
				".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
				"./sqlite": { types: "./dist/sqlite.d.ts", import: "./dist/sqlite.js" },
			},
			dependencies: source.dependencies,
		};
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify(pkg, null, 2) + "\n",
		);
		await cp(join(root, "LICENSE"), join(dir, "LICENSE"));
		const hashes: Record<string, string> = {};
		for (const file of await files(dir))
			hashes[file] = new Bun.CryptoHasher("sha256")
				.update(await readFile(join(dir, file)))
				.digest("hex");
		const sourceHashes: Record<string, string> = {};
		for (const file of await files(join(root, "src")))
			if (!file.includes("/test/") && !file.endsWith(".test.ts"))
				sourceHashes[file] = new Bun.CryptoHasher("sha256")
					.update(await readFile(join(root, "src", file)))
					.digest("hex");
		const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
			cwd: root,
			stdout: "pipe",
		})
			.stdout.toString()
			.trim();
		await writeFile(
			join(dir, "MANIFEST.json"),
			JSON.stringify(
				{
					format: 1,
					revision,
					sourceHashes,
					bun: Bun.version,
					typescript: JSON.parse(
						await readFile(
							join(root, "node_modules/typescript/package.json"),
							"utf8",
						),
					).version,
					files: hashes,
				},
				null,
				2,
			) + "\n",
		);
		await verifyPackage(dir);
		await mkdir(resolve(output, ".."), { recursive: true });
		const tar = Bun.spawn(["tar", "-czf", output, "-C", stage, "package"], {
			stdout: "inherit",
			stderr: "inherit",
		});
		if ((await tar.exited) !== 0) throw new Error("package_archive_failed");
		console.log(
			JSON.stringify({
				archive: output,
				files: Object.keys(hashes).length,
				sha256: new Bun.CryptoHasher("sha256")
					.update(await readFile(output))
					.digest("hex"),
			}),
		);
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
