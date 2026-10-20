import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SafePath =
	| { readonly ok: true; readonly abs: string; readonly rel: string }
	| {
			readonly ok: false;
			readonly errorCode: "invalid_path" | "path_escape" | "symlink_rejected";
			readonly message: string;
	  };

/**
 * Resolves `input` strictly inside `root`. Absolute paths, `..` escapes and
 * any symlink along the way are refused.
 */
export async function resolveInside(
	root: string,
	input: string,
	options: { readonly allowRoot?: boolean } = {},
): Promise<SafePath> {
	if (input.length === 0 || input.length > 200 || input.includes("\0")) {
		return { ok: false, errorCode: "invalid_path", message: "invalid path" };
	}
	if (input.includes("\\")) {
		return { ok: false, errorCode: "invalid_path", message: "invalid path" };
	}
	if (isAbsolute(input)) {
		return {
			ok: false,
			errorCode: "path_escape",
			message: "absolute paths are not allowed; use a path relative to work/",
		};
	}
	const rootAbs = resolve(root);
	const abs = resolve(rootAbs, input);
	const rel = relative(rootAbs, abs);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		return {
			ok: false,
			errorCode: "path_escape",
			message: "the path leaves the work directory",
		};
	}
	if (rel === "" && options.allowRoot !== true) {
		return { ok: false, errorCode: "invalid_path", message: "invalid path" };
	}
	let current = rootAbs;
	for (const part of rel.split(sep).filter((p) => p !== "")) {
		current = resolve(current, part);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) {
				return {
					ok: false,
					errorCode: "symlink_rejected",
					message: "symbolic links are not allowed",
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
			throw error;
		}
	}
	return { ok: true, abs, rel: rel.split(sep).join("/") };
}
