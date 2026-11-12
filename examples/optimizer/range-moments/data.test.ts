import { expect, test } from "bun:test";
import { momentsChecks } from "./data.ts";

test("overlapping updates and named restores keep three independent totals", () => {
	const [branch, modulo] = momentsChecks(43);
	expect(branch?.expected).toBe(
		"0 0 0\n18 106 45\n4 8 10\n16 102 43\n12 40 26\n",
	);
	expect(modulo?.expected).toBe(
		"1000000005 2 1000000002\n1000000006 1 1000000004\n4 6 7\n",
	);
});
