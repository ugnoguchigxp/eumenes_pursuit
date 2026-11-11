import { expect, test } from "bun:test";
import { inventoryChecks } from "./data.ts";

test("distance windows are inclusive and saved inventory ignores mutations to other branches", () => {
	const [branches, boundaries, singleSite] = inventoryChecks(0);
	expect(branches?.expected).toBe("2 15\n0 0\n1 6\n1 9\n3 28\n");
	expect(boundaries?.expected).toBe(
		"4 4000000000\n1 1000000000\n1 1000000000\n",
	);
	expect(singleSite?.expected).toBe("0 0\n1 5\n");
});
