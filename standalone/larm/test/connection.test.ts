import { afterEach, describe, expect, test } from "bun:test";
import type { JudgeRequest } from "../../../src/contracts/judge.ts";
import { type DecisionLease, openDecisionLease } from "../connection.ts";
import { smokeQuestions } from "../fixtures.ts";

const ORIGIN = "http://larm.test:9810";
const provider = {
	name: "decision",
	capability: "decision.general",
	protocol: "larm.system-one.v1",
	endpoint: "/v1/systemone",
	model: "d1-3b-general",
};
const catalog = {
	contractVersion: "agent-connection.v3",
	catalogRevision: "rev1",
	profiles: [
		{ id: "bg-training", schedulingPriority: 500, providers: [provider] },
		{ id: "bg-immediate", schedulingPriority: 1000, providers: [provider] },
	],
	audiences: ["saaa-desktop"],
};
const inferResponse = {
	model: "d1-3b-general",
	adapter: null,
	answers: {
		scope_expanding: { type: "noul", noul: 0.3, confidence: 0.7 },
		touches_checks: { type: "noul", noul: 0.1, confidence: 0.9 },
		flow: {
			type: "choice",
			choice: "stalled",
			confidence: 0.8,
			probabilities: { progressing: 0.1, stalled: 0.8, runaway: 0.1 },
		},
		closeness: {
			type: "score",
			score: 0.3,
			confidence: 0.8,
			probabilities: { "0": 0.8, "1": 0.1, "2": 0.05, "3": 0.05 },
		},
	},
	usage: { input_tokens: 100 },
	routing: {},
};
const request: JudgeRequest = {
	state: { goal: "g" },
	questions: smokeQuestions,
	questionSet: { id: "q", version: 1 },
	adapter: null,
};

interface Call {
	method: string;
	path: string;
	auth: string | null;
	body: unknown;
}

interface FakeOptions {
	agentProfile?: string;
	pendingPolls?: number;
	/** Status for the n-th (1-based) infer call; others 200. */
	inferStatus?: Record<number, number>;
	claimEndpointHost?: string;
}

function fakeLarm(options: FakeOptions = {}) {
	const calls: Call[] = [];
	let created = 0;
	let polls = 0;
	let infers = 0;
	const fetchImpl = async (
		input: string | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as unknown)
				: undefined;
		calls.push({
			method,
			path: url.pathname,
			auth: new Headers(init?.headers).get("authorization"),
			body,
		});
		const id = `conn-${created}`;
		const connection = (ready: boolean) => ({
			id,
			status: ready ? "ready" : "pending",
			agentProfile: options.agentProfile ?? "bg-immediate",
			providers: [
				{
					name: "decision",
					capability: "decision.general",
					readiness: ready ? "ready" : "starting",
					claimable: ready,
					model: "d1-3b-general",
				},
			],
			expiresAt: new Date(Date.now() + 900_000).toISOString(),
		});
		if (url.pathname === "/v3/agent-profiles") return Response.json(catalog);
		if (url.pathname === "/v1/agent-connections" && method === "POST") {
			created++;
			polls = 0;
			return Response.json(
				{ ...connection(false), id: `conn-${created}` },
				{ status: 202 },
			);
		}
		if (
			/^\/v1\/agent-connections\/[^/]+$/.test(url.pathname) &&
			method === "GET"
		) {
			polls++;
			return Response.json(connection(polls > (options.pendingPolls ?? 0)));
		}
		if (url.pathname.endsWith("/claim"))
			return Response.json({
				id: url.pathname.split("/")[3],
				status: "ready",
				expiresAt: new Date(Date.now() + 900_000).toISOString(),
				providers: [
					{
						name: "decision",
						endpoint: `http://${options.claimEndpointHost ?? "larm.test"}:9810/v1/systemone`,
						model: "d1-3b-general",
						credential: {
							type: "bearer",
							token: `tok-${created}`,
							expiresAt: new Date(Date.now() + 900_000).toISOString(),
						},
					},
				],
			});
		if (url.pathname.endsWith("/renew"))
			return Response.json({ id: url.pathname.split("/")[3], status: "ready" });
		if (method === "DELETE") return new Response(null, { status: 204 });
		if (url.pathname === "/v1/systemone") {
			infers++;
			const status = options.inferStatus?.[infers] ?? 200;
			if (status !== 200)
				return Response.json(
					{ error: { code: "unauthorized", message: "x" } },
					{ status },
				);
			return Response.json(inferResponse);
		}
		return new Response("?", { status: 500 });
	};
	return {
		calls,
		fetchImpl,
		count: (m: string, suffix: string) =>
			calls.filter((c) => c.method === m && c.path.endsWith(suffix)).length,
	};
}

let lease: DecisionLease | undefined;
afterEach(async () => {
	await lease?.release();
	lease = undefined;
});

function open(fake: ReturnType<typeof fakeLarm>) {
	lease = openDecisionLease({
		origin: ORIGIN,
		token: "control-token",
		selector: "decisionGeneral",
		audience: "saaa-desktop",
		clientId: "client-1",
		catalogCapability: "decision.general",
		fetch: fake.fetchImpl,
		pollMs: 1,
	});
	return lease;
}

const signal = () => new AbortController().signal;

describe("openDecisionLease", () => {
	test("connects lazily, reuses the lease, releases once", async () => {
		const fake = fakeLarm({ pendingPolls: 2 });
		const l = open(fake);
		expect(fake.calls).toHaveLength(0);
		await l.judge.ask(request, signal());
		await l.judge.ask(request, signal());
		expect(fake.count("POST", "/v1/agent-connections")).toBe(1);
		expect(fake.count("POST", "/claim")).toBe(1);
		const create = fake.calls.find(
			(c) => c.method === "POST" && c.path === "/v1/agent-connections",
		);
		expect(create?.body).toEqual({
			profile: "decisionGeneral",
			client: "client-1",
			audience: "saaa-desktop",
			providers: ["decision"],
			expectedCatalogRevision: "rev1",
		});
		expect(
			fake.calls.every(
				(c) => c.auth === "Bearer control-token" || c.path === "/v1/systemone",
			),
		).toBe(true);
		expect(fake.calls.find((c) => c.path === "/v1/systemone")?.auth).toBe(
			"Bearer tok-1",
		);
		await l.release();
		await l.release();
		expect(fake.count("DELETE", "conn-1")).toBe(1);
		await expect(l.judge.ask(request, signal())).rejects.toThrow(
			"larm_lease_closed",
		);
	});

	test("concurrent first asks share one connection", async () => {
		const fake = fakeLarm();
		const l = open(fake);
		await Promise.all([
			l.judge.ask(request, signal()),
			l.judge.ask(request, signal()),
		]);
		expect(fake.count("POST", "/v1/agent-connections")).toBe(1);
	});

	test("release without ever connecting makes no calls", async () => {
		const fake = fakeLarm();
		const l = open(fake);
		await l.release();
		expect(fake.calls).toHaveLength(0);
	});

	test("reconnects once after 401", async () => {
		const fake = fakeLarm({ inferStatus: { 1: 401 } });
		const l = open(fake);
		const response = await l.judge.ask(request, signal());
		expect(response.inputTokens).toBe(100);
		expect(fake.count("POST", "/v1/agent-connections")).toBe(2);
		expect(fake.count("DELETE", "conn-1")).toBe(1);
		expect(
			fake.calls.filter((c) => c.path === "/v1/systemone").map((c) => c.auth),
		).toEqual(["Bearer tok-1", "Bearer tok-2"]);
	});

	test("a second 401 is surfaced", async () => {
		const fake = fakeLarm({ inferStatus: { 1: 403, 2: 403 } });
		const l = open(fake);
		await expect(l.judge.ask(request, signal())).rejects.toMatchObject({
			httpStatus: 403,
		});
		expect(fake.count("POST", "/v1/agent-connections")).toBe(2);
	});

	test("profile mismatch releases the created connection", async () => {
		const fake = fakeLarm({ agentProfile: "bg-training" });
		const l = open(fake);
		await expect(l.judge.ask(request, signal())).rejects.toThrow(
			"larm_profile_mismatch",
		);
		expect(fake.count("DELETE", "conn-1")).toBe(1);
		expect(fake.count("POST", "/claim")).toBe(0);
	});

	test("never sends the provider token to another host", async () => {
		const fake = fakeLarm({ claimEndpointHost: "127.0.0.1" });
		const l = open(fake);
		await expect(l.judge.ask(request, signal())).rejects.toThrow(
			"larm_provider_host_mismatch",
		);
		expect(fake.calls.some((c) => c.path === "/v1/systemone")).toBe(false);
		expect(fake.count("DELETE", "conn-1")).toBe(1);
	});
});
