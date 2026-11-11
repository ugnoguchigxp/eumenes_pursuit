import { expect, test } from "bun:test";
import { selectStarters } from "../fixtures.ts";
import { profiles } from "../../../eval/optimizer/data.ts";
import {
	bulkChecks,
	ledgerChecks,
	ledgerWorkload,
	ordersFor,
	snapshotChecks,
	snapshotOrders,
} from "./data.ts";

test("ledger contract keeps the open bound, tie, zero width and replacement semantics", () => {
	const cases = ledgerChecks(0);
	expect(cases[0]?.expected).toBe("3 2 b\n0 0 -\n");
	expect(cases[1]?.expected).toBe("1 7 z\n0 0 -\n1 -9 z\n0 0 -\n1 0 z\n");
	expect(cases[2]?.expected).toBe("0 0 -\n1 -8 z\n0 0 -\n0 0 -\n");
});

test("indexed host oracle agrees with a direct scan on independent streams", () => {
	for (const profile of profiles) {
		for (let seed = 0; seed < 20; seed++) {
			const input = ordersFor(profile, 350, seed + 15);
			expect(ledgerWorkload("indexed", input).expected).toBe(
				ledgerWorkload("scan", input, false).expected,
			);
		}
	}
});

test("snapshots keep branch state, saved names and original query order", () => {
	expect(
		snapshotChecks(0).find((x) => x.id === "independent-branches")?.expected,
	).toBe("1 -2 a\n2 9 b\n0 0 -\n2 9 b\n0 0 -\n");
	for (const profile of profiles)
		for (let seed = 0; seed < 20; seed++) {
			const orders = snapshotOrders(profile, 500, seed);
			expect(ledgerWorkload("indexed", orders).expected).toBe(
				ledgerWorkload("scan", orders, false).expected,
			);
		}
});

test("bulk corrections stay within their branch and never reach later registrations", () => {
	const testCase = bulkChecks(0).find(
		({ id }) => id === "bulk-branch-and-lifecycle",
	);
	expect(testCase?.expected).toBe(
		"2 8 b\n2 6 c\n2 15 b\n0 0 -\n1 3 b\n1 2 c\n",
	);
});

test("paid runs exclude historical examples, including explicit selections", () => {
	expect(selectStarters("all", "compare")).toEqual([
		"bulk-snapshots",
		"inventory-branches",
	]);
	expect(selectStarters("all", "inspect")).toHaveLength(10);
	expect(() => selectStarters("all-scan", "api")).toThrow("retired sample");
	expect(() => selectStarters("snapshots", "compare")).toThrow(
		"retired sample",
	);
	expect(() => selectStarters("network-parity", "direct")).toThrow(
		"retired sample",
	);
	expect(() => selectStarters("network-versions", "compare")).toThrow(
		"retired sample",
	);
});
