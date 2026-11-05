/** Fail before any grading when the numerical verifier cannot run safely. */
const run = Bun.spawnSync(
	[
		"python3",
		"-c",
		"import sys; assert sys.version_info >= (3,11), 'Python >= 3.11 required'; import sympy,mpmath; print('Python',sys.version.split()[0], 'sympy',sympy.__version__, 'mpmath',mpmath.__version__)",
	],
	{ stdout: "pipe", stderr: "pipe" },
);
if (run.exitCode !== 0) {
	console.error(
		"Python >= 3.11 with requirements-eval.txt is required. Put its virtualenv/bin first on PATH before verify/eval.",
	);
	process.exit(1);
}
console.log(run.stdout.toString().trim());
