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

const hidden = String.raw`import { expect, test } from "bun:test";
import { splitEvenly, taxIncluded } from "../src/billing.ts";

test("[split-evenly] remainder goes to the first people", () => {
	expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
	expect(splitEvenly(10, 4)).toEqual([3, 3, 2, 2]);
	expect(splitEvenly(1, 3)).toEqual([1, 0, 0]);
	expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
	expect(splitEvenly(7, 1)).toEqual([7]);
	expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
});

test("[split-evenly] shares always add up to the total", () => {
	for (let total = 0; total < 60; total += 1) {
		for (let people = 1; people <= 7; people += 1) {
			const shares = splitEvenly(total, people);
			expect(shares).toHaveLength(people);
			expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
		}
	}
});

test("[split-evenly] people must be a positive integer", () => {
	expect(() => splitEvenly(100, 0)).toThrow(RangeError);
	expect(() => splitEvenly(100, -2)).toThrow(RangeError);
	expect(() => splitEvenly(100, 2.5)).toThrow(RangeError);
});

test("[tax-kept] taxIncluded keeps rounding halves up", () => {
	expect(taxIncluded(1000, 0.1)).toBe(1100);
	expect(taxIncluded(105, 0.1)).toBe(116);
	expect(taxIncluded(1999, 0.08)).toBe(2159);
	expect(taxIncluded(5, 0.1)).toBe(6);
	expect(taxIncluded(10, 0.05)).toBe(11);
	expect(taxIncluded(0, 0.1)).toBe(0);
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
	hiddenTests: { "billing.test.ts": hidden },
});
