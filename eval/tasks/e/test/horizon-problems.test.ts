import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tasks } from "../../index.ts";
import { horizonTasks } from "../horizon-problems.ts";

const signal = AbortSignal.timeout(120_000);

/** The hidden answers, repeated here so a change in either place fails the test. */
const cases: Record<
	string,
	{ answer: string; nearMisses: string[]; decimal: string }
> = {
	"hz-odd-harmonic-3": {
		answer: "pi^4/64 - 7*zeta(3)*log(2)/4",
		nearMisses: [
			"pi^4/64 - 7*zeta(3)*log(2)/8",
			"pi^4/72 - 7*zeta(3)*log(2)/4",
			"pi^4/64",
		],
		decimal: "0.063912929135327093289",
	},
	"hz-even-index-harmonic-3": {
		answer:
			"-pi^4/15 + 7*zeta(3)*log(2) - pi^2*log(2)^2/3 + log(2)^4/3 + 8*polylog(4, 1/2)",
		nearMisses: [
			"-pi^4/15 + 7*zeta(3)*log(2) - pi^2*log(2)^2/3 + log(2)^4/3 + 4*polylog(4, 1/2)",
			"-pi^4/15 + 7*zeta(3)*log(2) - pi^2*log(2)^2/3 + 8*polylog(4, 1/2)",
			"pi^4/9",
		],
		decimal: "1.9746275368413284954",
	},
	"hz-alt-harmonic-sq-2": {
		answer:
			"41*pi^4/1440 - 7*zeta(3)*log(2)/4 + pi^2*log(2)^2/12 - log(2)^4/12 - 2*polylog(4, 1/2)",
		nearMisses: [
			"41*pi^4/1440 - 7*zeta(3)*log(2)/4 + pi^2*log(2)^2/12 - log(2)^4/12 + 2*polylog(4, 1/2)",
			"41*pi^4/1440 - 7*zeta(3)*log(2)/4 + pi^2*log(2)^2/12 - 2*polylog(4, 1/2)",
			"17*pi^4/360",
		],
		decimal: "0.65631155160775220463",
	},
	"hz-odd-harmonic-4": {
		answer: "31*zeta(5)/8 - 7*pi^2*zeta(3)/32 - pi^4*log(2)/48",
		nearMisses: [
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/16 - pi^4*log(2)/48",
			"31*zeta(5)/16 - 7*pi^2*zeta(3)/32 - pi^4*log(2)/48",
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/32",
		],
		decimal: "0.016240657850235703095",
	},
};

async function verifyAnswers(id: string, expressions: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "hz-test-"));
	try {
		const task = horizonTasks.find((t) => t.id === id)!;
		const instance = await task.create(dir, { grader: null, toolTier: 0 });
		const out: { passed: boolean; assurance: string | undefined }[] = [];
		for (const expression of expressions) {
			const r = await instance.tools.invoke(
				{ tool: "submit_answer", input: { expression } },
				signal,
			);
			expect(r.status).toBe("ok");
			const [c] = await instance.acceptance.verify(signal);
			out.push({ passed: c!.passed, assurance: c!.assurance });
		}
		return out;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("horizon-1 tasks (hz-*)", () => {
	test("registered in group E, level 4, answer-only (no grader needed)", () => {
		expect(horizonTasks.map((t) => t.id).sort()).toEqual(
			Object.keys(cases).sort(),
		);
		for (const t of horizonTasks) {
			expect(tasks).toContain(t);
			expect(t.group).toBe("E");
			expect(t.level).toBe(4);
			expect(t.acceptance.map((a) => a.id)).toEqual(["answer-correct"]);
			expect(t.rubricSize ?? 0).toBe(0);
		}
	});

	test("goals and tool descriptions do not reveal any task's answer", async () => {
		const answers = [
			...Object.values(cases).map((c) => c.answer),
			"17*pi^4/360",
			"pi*log(2)/8",
			"pi^2/12 - log(2)^2/2",
		];
		const dir = mkdtempSync(join(tmpdir(), "hz-leak-"));
		try {
			for (const t of horizonTasks)
				for (const tier of [0, 1, 2, 3] as const) {
					const instance = await t.create(join(dir, `${t.id}-${tier}`), {
						grader: null,
						toolTier: tier,
					});
					const visible = [
						t.goalFor?.(tier) ?? t.goal,
						...t.acceptance.map((a) => a.text),
						JSON.stringify(instance.tools.list()),
					].join("\n");
					for (const a of answers) expect(visible).not.toContain(a);
					expect(visible).not.toContain("polylog(4, 1/2)");
					expect(visible).not.toContain("zeta(3)*log(2)");
				}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	for (const [id, c] of Object.entries(cases))
		test(`${id}: the answer passes; near misses and a 20-digit decimal fail`, async () => {
			const results = await verifyAnswers(id, [
				c.answer,
				...c.nearMisses,
				c.decimal,
			]);
			expect(results[0]!.passed).toBe(true);
			expect(["exact", "numeric"]).toContain(results[0]!.assurance!);
			expect(results.slice(1).map((r) => r.passed)).toEqual(
				Array(c.nearMisses.length + 1).fill(false),
			);
		});
});
