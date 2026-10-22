/** Daily check: format, lint, types, boundaries, run artifacts kept out of the index, deterministic tests. Live runs are separate (eval/). */
const steps = [
	["format:check"],
	["lint"],
	["typecheck"],
	["check:boundaries"],
	["check:results"],
	["test"],
];
for (const step of steps) {
	const child = Bun.spawn([process.execPath, "run", ...step], {
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await child.exited;
	if (code !== 0) process.exit(code);
}
console.log(
	"OK: deterministic checks. Live evaluation: bun eval/main.ts run --name <run>",
);

export {};
