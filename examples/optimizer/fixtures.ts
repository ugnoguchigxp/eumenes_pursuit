import { readFile } from "node:fs/promises";
import {
	completeSeries,
	executeCandidate,
	improvements,
	measure,
	percentile,
	runCandidate,
	type Series,
} from "../../eval/optimizer/benchmark.ts";
import {
	correctnessSuite,
	eventsFor,
	profiles,
	workload,
} from "../../eval/optimizer/data.ts";
import { faster } from "../../eval/optimizer/fixed.ts";
import { loadBaseline } from "../../eval/optimizer/task.ts";

import {
	encodeInventory,
	inventoryChecks,
	inventoryData,
} from "./inventory/data.ts";
import {
	bulkChecks,
	bulkOrders,
	encodeOrders,
	ledgerChecks,
	ledgerWorkload,
	ordersFor,
	snapshotChecks,
	snapshotOrders,
} from "./ledger/data.ts";

import {
	encode as encodeNetwork,
	networkChecks,
	networkData,
} from "./network/data.ts";

export const starters = {
	"all-scan": { expectedCorrect: true, primary: "mixed" },
	"per-user-scan": { expectedCorrect: true, primary: "concentrated" },
	"closed-left": { expectedCorrect: false, primary: "mixed" },
	"same-time": { expectedCorrect: false, primary: "mixed" },
	corrections: { expectedCorrect: false, primary: "mixed" },
	snapshots: { expectedCorrect: false, primary: "mixed" },
	"bulk-snapshots": { expectedCorrect: false, primary: "mixed" },
	"network-parity": { expectedCorrect: false, primary: "mixed" },
	"network-versions": { expectedCorrect: false, primary: "mixed" },
	"inventory-branches": { expectedCorrect: false, primary: "mixed" },
} as const;

export type Starter = keyof typeof starters;

export const liveStarters: readonly Starter[] = [
	"bulk-snapshots",
	"inventory-branches",
];

export function selectStarters(
	selection: string,
	mode: "inspect" | "api" | "direct" | "compare" | "compare-selection",
): Starter[] {
	const names = (
		selection === "all"
			? mode === "inspect"
				? Object.keys(starters)
				: [...liveStarters]
			: selection.split(",")
	) as Starter[];
	if (
		!names.every((name) => Object.hasOwn(starters, name)) ||
		new Set(names).size !== names.length
	)
		throw new Error("invalid sample selection");
	if (mode !== "inspect" && names.some((name) => !liveStarters.includes(name)))
		throw new Error("retired sample: use inspect for historical starters");
	return names;
}

const bulkOperations = 100000;
const readLedger = (name: string) =>
	readFile(new URL(`./ledger/${name}`, import.meta.url), "utf8");

async function referenceWorkload(reference: string, id: string, input: string) {
	const result = await executeCandidate(
		reference,
		input,
		6000,
		AbortSignal.timeout(15000),
	);
	if (result.timedOut || result.exitCode !== 0)
		throw new Error(`optimizer_reference_failed:${id}`);
	return { id, input, expected: result.stdout };
}

const bulkWorkload = (
	reference: string,
	profile: (typeof profiles)[number],
	size: number,
	seed: number,
	id: string,
) =>
	referenceWorkload(
		reference,
		id,
		encodeOrders(bulkOrders(profile, size, seed)),
	);
const networkOperations = 60000;
const inventoryOperations = 50000;
const readInventory = (name: string) =>
	readFile(new URL(`./inventory/${name}`, import.meta.url), "utf8");
const inventoryWorkload = (
	reference: string,
	profile: (typeof profiles)[number],
	size: number,
	seed: number,
	id: string,
) => {
	const { edges, orders } = inventoryData(profile, size, seed);
	return referenceWorkload(reference, id, encodeInventory(edges, orders));
};
async function networkReference(versioned: boolean) {
	const source = await readFile(
		new URL("./network/reference.py", import.meta.url),
		"utf8",
	);
	return versioned
		? source.replace("    main()\n", "    main(versioned=True)\n")
		: source;
}
const networkWorkload = (
	reference: string,
	profile: (typeof profiles)[number],
	size: number,
	seed: number,
	id: string,
	versioned: boolean,
) => {
	const { vertices, orders } = networkData(profile, size, seed, versioned);
	return referenceWorkload(reference, id, encodeNetwork(vertices, orders));
};

export async function fixture(name: Starter) {
	const versioned = name === "network-versions";
	const initialSource = await readFile(
		new URL(
			`./starters/${versioned ? "network-parity" : name}.py`,
			import.meta.url,
		),
		"utf8",
	);
	if (name === "inventory-branches") {
		const reference = await readInventory("reference.py");
		const timing = [];
		for (const profile of profiles)
			timing.push(
				await inventoryWorkload(reference, profile, 1400, 4681, profile),
			);
		return {
			initialSource,
			baselineSource: initialSource
				.replace("saved[a] = stock", "saved[a] = stock.copy()")
				.replace(
					"stock = saved.get(a, stock)",
					"if a in saved:\n                stock = saved[a].copy()",
				),
			expectedCorrect: false,
			reference,
			operationCount: inventoryOperations,
			specification: await readInventory("README.md"),
			goal: "windowsum.py の配送網の在庫照会を修正して高速化する。README.md の操作仕様と、未使用の5万操作・3秒の要件を満たす。正しさと速度を検証した最良版を提出する。",
			correctness: inventoryChecks(1549),
			timing,
			large: [
				await inventoryWorkload(
					reference,
					"distributed",
					inventoryOperations,
					94709,
					"development-50000",
				),
			],
		};
	}
	if (name === "network-parity" || versioned) {
		const reference = await networkReference(versioned);
		const specification = await readFile(
			new URL("./network/README.md", import.meta.url),
			"utf8",
		);
		const timing = [];
		for (const profile of profiles)
			timing.push(
				await networkWorkload(
					reference,
					profile,
					4000,
					4681,
					profile,
					versioned,
				),
			);
		return {
			initialSource,
			baselineSource: initialSource
				.replace(
					"links.setdefault(a, tuple(map(int, rest)))",
					"links[a] = tuple(map(int, rest))",
				)
				.replace(
					"saved[a] = links, weights",
					"saved[a] = links.copy(), weights.copy()",
				)
				.replace(
					"links, weights = saved.get(a, (links, weights))",
					"if a in saved:\n                links, weights = (part.copy() for part in saved[a])",
				),
			expectedCorrect: false,
			reference,
			operationCount: networkOperations,
			specification: versioned
				? specification +
					(await readFile(
						new URL("./network/versions.md", import.meta.url),
						"utf8",
					))
				: specification,
			goal: "windowsum.py の動的ネットワーク照会を修正して高速化する。README.md の操作仕様と、未使用の6万操作・3秒の要件を満たす。正しさと速度を検証した最良版を提出する。",
			correctness: networkChecks(137, versioned),
			timing,
			large: [
				await networkWorkload(
					reference,
					"concentrated",
					networkOperations,
					97813,
					"development-60000",
					versioned,
				),
			],
		};
	}
	if (
		name === "corrections" ||
		name === "snapshots" ||
		name === "bulk-snapshots"
	) {
		const branched = name !== "corrections";
		const checks = branched ? snapshotChecks : ledgerChecks;
		const orders = branched ? snapshotOrders : ordersFor;
		const baselineSource = initialSource
			.replace(
				"accounts.setdefault(key, (user, int(t), int(amount)))",
				"accounts[key] = (user, int(t), int(amount))",
			)
			.replace("end - width <= t <= end", "end - width < t <= end")
			.replace("snapshots[key] = accounts", "snapshots[key] = accounts.copy()")
			.replace("accounts = snapshots[key]", "accounts = snapshots[key].copy()");
		if (name === "bulk-snapshots") {
			const specification =
				(await readLedger("README.md")) +
				"\n" +
				(await readLedger("snapshots.md")) +
				"\n" +
				(await readLedger("bulk.md"));
			const reference = await readLedger("bulk-reference.py");
			const timing = [];
			for (const profile of profiles)
				timing.push(
					await bulkWorkload(reference, profile, 6000, 7769, profile),
				);
			return {
				initialSource,
				baselineSource,
				expectedCorrect: false,
				specification: specification
					.replaceAll("200,000", "100,000")
					.replaceAll("200000", "100000"),
				reference,
				operationCount: bulkOperations,
				goal: "windowsum.py の分岐・一括訂正付き取引台帳を修正し、高速化する。README.md の入出力仕様と10万操作・3秒の要件を満たす。正しさを確認して速度を計測し、検証済みの最良版を提出する。",
				correctness: bulkChecks(2833),
				timing,
				large: [
					await bulkWorkload(
						reference,
						"concentrated",
						bulkOperations,
						9781,
						"development-100000",
					),
				],
			};
		}
		const sharedSpec = await readFile(
			new URL("./ledger/README.md", import.meta.url),
			"utf8",
		);
		return {
			initialSource,
			baselineSource,
			expectedCorrect: false,
			specification: branched
				? sharedSpec +
					"\n" +
					(await readFile(
						new URL("./ledger/snapshots.md", import.meta.url),
						"utf8",
					))
				: sharedSpec,
			reference: await readFile(
				new URL("./ledger/reference.py", import.meta.url),
				"utf8",
			),
			goal: "windowsum.py の取引台帳を修正し、高速化する。README.md の操作、出力、20万操作・3秒の仕様を満たす。正しさを確認して速度を計測し、検証済みの最良版を提出する。",
			correctness: checks(2833),
			timing: profiles.map((profile) =>
				ledgerWorkload(profile, orders(profile, branched ? 5500 : 7000, 7769)),
			),
			large: [
				ledgerWorkload(
					"development-200000",
					orders("concentrated", 200000, 9781),
				),
			],
		};
	}
	const spec = starters[name];
	const baselineSource = spec.expectedCorrect
		? initialSource
		: await loadBaseline();
	const ordered = [
		spec.primary,
		...profiles.filter((item) => item !== spec.primary),
	];
	return {
		initialSource,
		baselineSource,
		expectedCorrect: spec.expectedCorrect,
		correctness: correctnessSuite(2833),
		timing: ordered.map((profile) =>
			workload(profile, eventsFor(profile, 3000, 7769)),
		),
		large: [
			workload("development-200000", eventsFor(spec.primary, 200000, 9781)),
		],
	};
}

export async function calibrate(
	data: Awaited<ReturnType<typeof fixture>>,
	signal: AbortSignal,
) {
	const initial = await measure(
		runCandidate,
		data.baselineSource,
		data.baselineSource,
		data.timing,
		signal,
	);
	const reference = data.reference ?? faster;
	const fast = await measure(
		runCandidate,
		reference,
		reference,
		data.timing,
		signal,
	);
	if (![...initial, ...fast].every(completeSeries))
		throw new Error("optimizer_calibration_incomplete");
	const noise = Object.fromEntries(
		initial.map(({ id }, i) => [
			id,
			percentile(
				[...improvements(initial[i]!), ...improvements(fast[i]!)].map(Math.abs),
				0.95,
			),
		]),
	);
	return { initial, fast, noise };
}

// If noise alone can obscure a fifth of the baseline runtime, this setup cannot
// distinguish an improvement of that size. Keep the original promotion test.
export function unstableCalibration(
	initial: readonly Series[],
	noise: Readonly<Record<string, number>>,
) {
	return initial.flatMap(({ id, pairs }) => {
		const baselineMs = percentile(
			pairs.flatMap(({ control, candidate }) => [control.ms, candidate.ms]),
			0.5,
		);
		const thresholdMs = noise[id]!;
		const noiseFraction = thresholdMs / baselineMs;
		return noiseFraction > 0.2
			? [{ id, baselineMs, thresholdMs, noiseFraction }]
			: [];
	});
}

export async function heldOut(name: Starter) {
	if (name === "inventory-branches") {
		const reference = await readInventory("reference.py");
		const speed = [];
		for (const profile of profiles)
			speed.push(
				await inventoryWorkload(
					reference,
					profile,
					inventoryOperations,
					55793,
					profile,
				),
			);
		return { correctness: inventoryChecks(18373), speed };
	}
	const versioned = name === "network-versions";
	if (name === "network-parity" || versioned) {
		const reference = await networkReference(versioned);
		const speed = [];
		for (const profile of profiles)
			speed.push(
				await networkWorkload(
					reference,
					profile,
					networkOperations,
					32527,
					profile,
					versioned,
				),
			);
		return { correctness: networkChecks(39183, versioned), speed };
	}
	if (name === "bulk-snapshots") {
		const reference = await readLedger("bulk-reference.py");
		const speed = [];
		for (const profile of profiles)
			speed.push(
				await bulkWorkload(reference, profile, bulkOperations, 81899, profile),
			);
		return { correctness: bulkChecks(19019), speed };
	}
	if (name === "corrections" || name === "snapshots") {
		const branched = name === "snapshots";
		const checks = branched ? snapshotChecks : ledgerChecks;
		const orders = branched ? snapshotOrders : ordersFor;
		return {
			correctness: checks(19019),
			speed: profiles.map((profile) =>
				ledgerWorkload(profile, orders(profile, 200000, 42529)),
			),
		};
	}
	return {
		correctness: correctnessSuite(19019),
		speed: profiles.map((profile) =>
			workload(profile, eventsFor(profile, 200000, 42529)),
		),
	};
}
