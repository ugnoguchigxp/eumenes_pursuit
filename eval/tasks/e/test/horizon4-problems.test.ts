import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tasks } from "../../index.ts";
import {
	horizon2Tasks,
	horizon3Tasks,
	horizon4Tasks,
	horizonTasks,
} from "../horizon-problems.ts";

const signal = AbortSignal.timeout(120_000);

/** Hidden answers repeated here, with plausible neighbouring formulas that must fail. */
const cases: Record<
	string,
	{
		answer: string;
		nearMisses: string[];
		equivalents: string[];
		decimal: string;
	}
> = {
	"hz4-alt-harmonic-sq-4": {
		answer: "-zeta(3)^2 + 709*pi^6/181440 - 31*zeta(5)*log(2)/16 + zbar(5, 1)",
		nearMisses: [
			"-zeta(3)^2 + 709*pi^6/181440 - 31*zeta(5)*log(2)/16 - zbar(5, 1)",
			"-zeta(3)^2 + 709*pi^6/181440 - 31*zeta(5)*log(2)/16",
			"97*pi^6/22680 - 2*zeta(3)^2",
			"-zeta(3)^2 + 709*pi^6/181440 - 15*zeta(5)*log(2)/8 + zbar(5, 1)",
		],
		equivalents: [
			"zbar(5,1) + 709*945*zeta(6)/181440 - zeta(3)**2 - 31*log(2)*zeta(5)/16",
		],
		decimal: "0.8893431408602049251677211",
	},
	"hz4-alt-harmonic-cube-3": {
		answer:
			"9*zeta(3)^2/64 + 23*pi^6/20160 + 279*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/16 - pi^4*log(2)^2/48 - 7*zeta(3)*log(2)^3/4 + 7*pi^2*log(2)^4/48 - log(2)^6/6 - 6*polylog(4, 1/2)*log(2)^2 - 12*polylog(5, 1/2)*log(2) - 12*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/2 - 9*zbar(5, 1)/2",
		nearMisses: [
			"9*zeta(3)^2/64 + 23*pi^6/20160 + 279*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/16 - pi^4*log(2)^2/48 - 7*zeta(3)*log(2)^3/4 + 7*pi^2*log(2)^4/48 - log(2)^6/6 - 6*polylog(4, 1/2)*log(2)^2 - 12*polylog(5, 1/2)*log(2) - 12*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/2 - 3*zbar(5, 1)",
			"9*zeta(3)^2/64 + 23*pi^6/20160 + 279*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/16 - pi^4*log(2)^2/48 - 7*zeta(3)*log(2)^3/4 + 7*pi^2*log(2)^4/48 - log(2)^6/6 - 6*polylog(4, 1/2)*log(2)^2 - 12*polylog(5, 1/2)*log(2) + pi^2*polylog(4, 1/2)/2 - 9*zbar(5, 1)/2",
			"9*zeta(3)^2/64 + 23*pi^6/20160 + 279*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/16 - pi^4*log(2)^2/48 - 7*zeta(3)*log(2)^3/4 + 7*pi^2*log(2)^4/48 - log(2)^6/6 - 6*polylog(4, 1/2)*log(2)^2 - 12*polylog(5, 1/2)*log(2) - 12*polylog(6, 1/2) - pi^2*polylog(4, 1/2)/2 - 9*zbar(5, 1)/2",
			"23*zeta(3)^2/64 - 673*pi^6/181440 + 93*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/48 - pi^4*log(2)^2/144 + pi^2*log(2)^4/144 + pi^2*polylog(4, 1/2)/6 - 3*zbar(5, 1)/2",
		],
		equivalents: [],
		decimal: "0.7210567939768637831290566",
	},
	"hz4-alt-harmonic-h2-3": {
		answer:
			"23*zeta(3)^2/64 - 673*pi^6/181440 + 93*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/48 - pi^4*log(2)^2/144 + pi^2*log(2)^4/144 + pi^2*polylog(4, 1/2)/6 - 3*zbar(5, 1)/2",
		nearMisses: [
			"23*zeta(3)^2/64 - 673*pi^6/181440 + 93*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/48 - pi^4*log(2)^2/144 + pi^2*log(2)^4/144 + pi^2*polylog(4, 1/2)/6 + 3*zbar(5, 1)/2",
			"23*zeta(3)^2/64 - 673*pi^6/181440 + 93*zeta(5)*log(2)/32 + 7*pi^2*zeta(3)*log(2)/48 - pi^4*log(2)^2/144 + pi^2*log(2)^4/144 - 3*zbar(5, 1)/2",
			"-zeta(3)^2 + 709*pi^6/181440 - 31*zeta(5)*log(2)/16 + zbar(5, 1)",
		],
		equivalents: [],
		decimal: "0.8282563979832776977976382",
	},
	"hz4-harmonic-sq-half-4": {
		answer:
			"-17*zeta(3)^2/32 + pi^6/720 - 31*zeta(5)*log(2)/16 + pi^2*zeta(3)*log(2)/6 + 3*pi^4*log(2)^2/320 - pi^2*log(2)^4/96 + 13*log(2)^6/720 + polylog(4, 1/2)*log(2)^2/2 - 2*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/12 - 5*zbar(5, 1)/4",
		nearMisses: [
			"-17*zeta(3)^2/32 + pi^6/720 - 31*zeta(5)*log(2)/16 + pi^2*zeta(3)*log(2)/6 + 3*pi^4*log(2)^2/320 - pi^2*log(2)^4/96 + 13*log(2)^6/720 + polylog(4, 1/2)*log(2)^2/2 + 2*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/12 - 5*zbar(5, 1)/4",
			"-17*zeta(3)^2/32 + pi^6/720 - 31*zeta(5)*log(2)/16 + pi^2*zeta(3)*log(2)/6 + 3*pi^4*log(2)^2/320 - pi^2*log(2)^4/96 + 13*log(2)^6/720 + polylog(4, 1/2)*log(2)^2/2 - 2*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/12",
			"-17*zeta(3)^2/32 + pi^6/720 - 31*zeta(5)*log(2)/16 + pi^2*zeta(3)*log(2)/6 + 3*pi^4*log(2)^2/320 - pi^2*log(2)^4/96 + 13*log(2)^6/720 + polylog(4, 1/2)*log(2)^2/2 - 2*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/12 + 5*zbar(5, 1)/4",
		],
		equivalents: [
			"-17*zeta(3)^2/32 + 21*zeta(6)/16 - 31*zeta(5)*log(2)/16 + pi^2*zeta(3)*log(2)/6 + 3*pi^4*log(2)^2/320 - pi^2*log(2)^4/96 + 13*log(2)^6/720 + polylog(4, 1/2)*log(2)^2/2 - 2*polylog(6, 1/2) + pi^2*polylog(4, 1/2)/12 - 5*zbar(5, 1)/4",
		],
		decimal: "0.5417684654284048660203891",
	},
};

async function verifyAnswers(id: string, expressions: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "hz4-test-"));
	try {
		const task = horizon4Tasks.find((t) => t.id === id)!;
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

describe("horizon-4 tasks (hz4-*)", () => {
	test("registered in group E, level 4, answer-only; earlier tiers kept", () => {
		expect(horizon4Tasks.map((t) => t.id).sort()).toEqual(
			Object.keys(cases).sort(),
		);
		expect(horizonTasks).toHaveLength(4);
		expect(horizon2Tasks).toHaveLength(4);
		expect(horizon3Tasks).toHaveLength(4);
		for (const t of horizon4Tasks) {
			expect(tasks).toContain(t);
			expect(t.group).toBe("E");
			expect(t.level).toBe(4);
			expect(t.acceptance.map((a) => a.id)).toEqual(["answer-correct"]);
			expect(t.rubricSize ?? 0).toBe(0);
		}
	});

	test("nothing the generator sees contains an answer or a basis constant", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hz4-leak-"));
		try {
			for (const t of horizon4Tasks)
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
						"zeta(3)^2",
						"pi^6",
						"polylog(6",
						"polylog(4, 1/2)",
						"zbar(5, 1)/",
						"*zbar(5, 1)",
					])
						expect(visible).not.toContain(piece);
				}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	for (const [id, c] of Object.entries(cases))
		test(`${id}: the answer and a rewritten form pass; neighbouring formulas and a 25-digit decimal fail`, async () => {
			const results = await verifyAnswers(id, [
				c.answer,
				...c.equivalents,
				...c.nearMisses,
				c.decimal,
			]);
			const good = 1 + c.equivalents.length;
			for (const r of results.slice(0, good)) {
				expect(r.passed).toBe(true);
				expect(["exact", "numeric"]).toContain(r.assurance!);
			}
			expect(results.slice(good).map((r) => r.passed)).toEqual(
				Array(c.nearMisses.length + 1).fill(false),
			);
		});
});
