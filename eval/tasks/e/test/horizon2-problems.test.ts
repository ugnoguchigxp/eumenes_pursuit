import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tasks } from "../../index.ts";
import { horizon2Tasks, horizonTasks } from "../horizon-problems.ts";

const signal = AbortSignal.timeout(120_000);

/** Hidden answers repeated here, with plausible neighbouring formulas that must fail. */
const cases: Record<
	string,
	{ answer: string; nearMisses: string[]; decimal: string }
> = {
	"hz2-odd-harmonic-sq-3": {
		answer:
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/48 - pi^4*log(2)/16 + 7*zeta(3)*log(2)^2/2",
		nearMisses: [
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/32 - pi^4*log(2)/48",
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/48 - pi^4*log(2)/16 + 7*zeta(3)*log(2)^2/4",
			"31*zeta(5)/8 - 7*pi^2*zeta(3)/48 + pi^4*log(2)/16 - 7*zeta(3)*log(2)^2/2",
		],
		decimal: "0.08938796105978283571070484",
	},
	"hz2-alt-harmonic2-3": {
		answer: "5*pi^2*zeta(3)/48 - 11*zeta(5)/32",
		nearMisses: [
			"59*zeta(5)/32 - pi^2*zeta(3)/12",
			"11*zeta(5)/32 - 5*pi^2*zeta(3)/48",
			"5*pi^2*zeta(3)/48 - 11*zeta(5)/16",
		],
		decimal: "0.8793713031052766616967715",
	},
	"hz2-alt-harmonic-sq-3": {
		answer:
			"-19*zeta(5)/32 - 11*pi^2*zeta(3)/48 + 7*zeta(3)*log(2)^2/4 - pi^2*log(2)^3/9 + 2*log(2)^5/15 + 4*polylog(4, 1/2)*log(2) + 4*polylog(5, 1/2)",
		nearMisses: [
			"-19*zeta(5)/32 - 11*pi^2*zeta(3)/48 + 7*zeta(3)*log(2)^2/4 - pi^2*log(2)^3/9 + 2*log(2)^5/15",
			"-19*zeta(5)/32 - 11*pi^2*zeta(3)/48 + 7*zeta(3)*log(2)^2/4 - pi^2*log(2)^3/9 + 2*log(2)^5/15 + 4*polylog(4, 1/2)*log(2) - 4*polylog(5, 1/2)",
			"-19*zeta(5)/32 + 11*pi^2*zeta(3)/48 + 7*zeta(3)*log(2)^2/4 - pi^2*log(2)^3/9 + 2*log(2)^5/15 + 4*polylog(4, 1/2)*log(2) + 4*polylog(5, 1/2)",
		],
		decimal: "0.8007016458915982000535498",
	},
	"hz2-harmonic-half-4": {
		answer:
			"zeta(5)/32 - pi^2*zeta(3)/12 - pi^4*log(2)/720 + zeta(3)*log(2)^2/2 - pi^2*log(2)^3/36 + log(2)^5/40 + polylog(4, 1/2)*log(2) + 2*polylog(5, 1/2)",
		nearMisses: [
			"zeta(5)/32 - pi^2*zeta(3)/12 - pi^4*log(2)/720 + zeta(3)*log(2)^2/2 - pi^2*log(2)^3/36 + log(2)^5/40 + polylog(4, 1/2)*log(2) + polylog(5, 1/2)",
			"zeta(5)/32 - pi^2*zeta(3)/12 - pi^4*log(2)/720 + zeta(3)*log(2)^2/2 - pi^2*log(2)^3/36 + log(2)^5/40 + 2*polylog(5, 1/2)",
			"zeta(5)/32 - pi^2*zeta(3)/12 - pi^4*log(2)/720 + zeta(3)*log(2)^2/2 + pi^2*log(2)^3/36 + log(2)^5/40 + polylog(4, 1/2)*log(2) + 2*polylog(5, 1/2)",
		],
		decimal: "0.5269313653077353205014671",
	},
};

async function verifyAnswers(id: string, expressions: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "hz2-test-"));
	try {
		const task = horizon2Tasks.find((t) => t.id === id)!;
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

describe("horizon-2 tasks (hz2-*)", () => {
	test("registered in group E, level 4, answer-only; hz-* kept", () => {
		expect(horizon2Tasks.map((t) => t.id).sort()).toEqual(
			Object.keys(cases).sort(),
		);
		expect(horizonTasks).toHaveLength(4);
		for (const t of horizon2Tasks) {
			expect(tasks).toContain(t);
			expect(t.group).toBe("E");
			expect(t.level).toBe(4);
			expect(t.acceptance.map((a) => a.id)).toEqual(["answer-correct"]);
			expect(t.rubricSize ?? 0).toBe(0);
		}
	});

	test("nothing the generator sees contains an answer or a basis constant", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hz2-leak-"));
		try {
			for (const t of horizon2Tasks)
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
					for (const c of Object.values(cases)) {
						expect(visible).not.toContain(c.answer);
						expect(visible).not.toContain(c.decimal.slice(0, 8));
					}
					for (const piece of [
						"zeta(5)",
						"polylog(5",
						"polylog(4, 1/2)",
						"zeta(3)*log(2)",
					])
						expect(visible).not.toContain(piece);
				}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	for (const [id, c] of Object.entries(cases))
		test(`${id}: the answer passes; neighbouring formulas and a 25-digit decimal fail`, async () => {
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
