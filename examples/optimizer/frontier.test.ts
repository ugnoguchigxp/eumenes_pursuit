import { expect, test } from "bun:test";
import { fixture, heldOut, selectStarters } from "./fixtures.ts";
import {
	frontierFixture,
	frontierStarters,
	type FrontierStarter,
} from "./frontier.ts";

const names = Object.keys(frontierStarters) as FrontierStarter[];
const python = Bun.which("python3");
const run = (source: string, input: string, timeout = 60000) => {
	const result = Bun.spawnSync([python!, "-c", source], {
		stdin: Buffer.from(input),
		timeout,
	});
	return result.exitCode === 0 ? result.stdout.toString() : null;
};

test("frontier starters run by name and stay out of the default campaign", () => {
	expect(selectStarters(names.join(","), "api")).toEqual(names);
	expect(selectStarters("all", "api")).not.toContain(names[0]);
});

for (const name of names) {
	test(`${name}: the fixture has every tier, three timing inputs and held-out inputs`, async () => {
		const data = await fixture(name);
		const audit = await heldOut(name);
		expect(data.correctness.map(({ id }) => id)).toEqual(
			[1, 2, 3, 4, 5].map((t) => `check-t${t}`),
		);
		expect(data.timing).toHaveLength(3);
		expect(audit.speed).toHaveLength(3);
		expect(data.specification).toContain("windowsum.py");
		expect(data.specification).not.toContain("solve.py");
		expect(data.specification).not.toContain("samples/");
		expect(data.specification).not.toContain("段階6");
		expect(data.specification).not.toContain("| 6 |");
		expect(data.specification).toContain("| 5 |");
		const development = new Set(
			[...data.correctness, ...data.timing, ...data.large].map((w) => w.input),
		);
		for (const workload of [...audit.correctness, ...audit.speed])
			expect(development.has(workload.input)).toBe(false);
	});

	test.skipIf(!python)(
		`${name}: the reference answers everything, the control is correct, the starter is not`,
		async () => {
			const data = await frontierFixture(name);
			const audit = await heldOut(name);
			for (const workload of [
				...data.correctness,
				...data.timing,
				...data.large,
				...audit.correctness,
				...audit.speed,
			])
				expect(run(data.reference, workload.input)).toBe(workload.expected);
			for (const workload of data.timing)
				expect(run(data.baselineSource, workload.input)).toBe(
					workload.expected,
				);
			const starter = data.correctness
				.slice(0, 4)
				.map(
					(workload) =>
						run(data.initialSource, workload.input, 5000) === workload.expected,
				);
			expect(starter).toContain(false);
		},
		120000,
	);
}
