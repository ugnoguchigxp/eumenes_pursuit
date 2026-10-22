import { defineCodeTask } from "./kit.ts";

const yen = String.raw`/** Rounds to a whole yen, halves away from zero. */
export function toYen(value: number): number {
	return Math.round(value);
}
`;

const billing = String.raw`import { toYen } from "./yen.ts";

/** Price including consumption tax, rounded to a whole yen. */
export function taxIncluded(price: number, rate: number): number {
	return toYen(price * (1 + rate));
}

/** Splits total yen among people; the shares must add up to total. */
export function splitEvenly(total: number, people: number): number[] {
	const share = toYen(total / people);
	return Array.from({ length: people }, () => share);
}
`;

const visible = String.raw`import { expect, test } from "bun:test";
import { splitEvenly, taxIncluded } from "../src/billing.ts";

test("taxIncluded rounds to a whole yen", () => {
	expect(taxIncluded(1000, 0.1)).toBe(1100);
	expect(taxIncluded(105, 0.1)).toBe(116);
});

test("splitEvenly splits an exact multiple", () => {
	expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
});

test("splitEvenly shares add up to the total", () => {
	const shares = splitEvenly(100, 3);
	expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
});
`;

export const splitBill = defineCodeTask({
	id: "d-split-bill-shared-rounding",
	title: "割り勘の合計が合わない（共有の丸め関数）",
	goal: "work/src/billing.ts の splitEvenly(total, people) は、各人の支払額の合計が total と一致しないことがあります。合計がちょうど total になるように直してください。端数が出るときは、先頭の人から 1 円ずつ多く負担します。people が 1 以上の整数でないときは RangeError を投げます。同じファイルの taxIncluded など、他の関数の既存の挙動は変えないでください。",
	acceptance: [
		{
			id: "split-evenly",
			text: "splitEvenly の各人の額の合計が total と一致し、端数は先頭の人から 1 円ずつ多く負担され、people が 1 以上の整数でないときは RangeError になること。",
			method: "machine",
		},
		{
			id: "tax-kept",
			text: "taxIncluded の既存の挙動（円未満は四捨五入）が変わっていないこと。",
			method: "machine",
		},
	],
	consultAnswer:
		"仕様は目標に書いたとおりです。ほかに決めていることはありません。",
	traps: [
		"原因に見える共有関数 toYen を直すと、taxIncluded の丸めが壊れる",
		"見えるテストは端数のない場合の期待値だけで、端数の配り方は書かれていない",
	],
	work: {
		"src/yen.ts": yen,
		"src/billing.ts": billing,
		"test/billing.test.ts": visible,
	},
	cases: [
		...[
			[100, 3],
			[10, 4],
			[1, 3],
			[0, 3],
			[7, 1],
			[900, 3],
			...Array.from({ length: 60 }, (_, total) =>
				Array.from({ length: 7 }, (_, i) => [total, i + 1]),
			).flat(),
		].map(([total, people], i) => ({
			caseId: `split-${i}`,
			criterionId: "split-evenly",
			modulePath: "src/billing.ts",
			exportName: "splitEvenly",
			args: [total!, people!],
			expected: Array.from(
				{ length: people! },
				(_, j) => Math.floor(total! / people!) + (j < total! % people! ? 1 : 0),
			),
		})),
		...[0, -2, 2.5].map((people, i) => ({
			caseId: `invalid-${i}`,
			criterionId: "split-evenly",
			modulePath: "src/billing.ts",
			exportName: "splitEvenly",
			args: [100, people],
			throws: "RangeError",
		})),
		...[
			[1000, 0.1, 1100],
			[105, 0.1, 116],
			[1999, 0.08, 2159],
			[5, 0.1, 6],
			[10, 0.05, 11],
			[0, 0.1, 0],
		].map(([price, rate, expected], i) => ({
			caseId: `tax-${i}`,
			criterionId: "tax-kept",
			modulePath: "src/billing.ts",
			exportName: "taxIncluded",
			args: [price!, rate!],
			expected: expected!,
		})),
	],
});
