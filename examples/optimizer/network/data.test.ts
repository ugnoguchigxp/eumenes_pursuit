import { expect, test } from "bun:test";
import { networkChecks } from "./data.ts";

test("replacement, contradictory cycles, and component weight have independent expected outputs", () => {
	const cases = networkChecks(0);
	expect(cases[0]?.expected).toBe(
		"different 2 0\nunknown 2 0\nsame 2 0\nunknown 1 0\n",
	);
	expect(cases[1]?.expected).toBe(
		"conflict 3 0\nunknown 3 0\ndifferent 3 0\nconflict 3 0\nsame 3 0\n",
	);
	expect(cases[2]?.expected).toBe(
		"same 2 1999999997\nunknown 1 2000000000\nunknown 1 -3\ndifferent 2 -3\n",
	);
});

test("restores link and weight state independently of the saved-name table", () => {
	const workload = networkChecks(0, true).find(
		({ id }) => id === "restore-and-overwrite",
	);
	expect(workload?.expected).toBe(
		"unknown 2 0\nunknown 1 0\ndifferent 2 9\ndifferent 2 9\nunknown 1 9\n",
	);
});
