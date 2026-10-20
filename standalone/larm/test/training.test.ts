import { describe, expect, test } from "bun:test";
import { createControl } from "../control.ts";
import { createTrainingClient } from "../training.ts";

interface Seen {
	method: string;
	path: string;
	headers: Headers;
	body: string | undefined;
}

function client(respond: (seen: Seen) => Response) {
	const calls: Seen[] = [];
	const control = createControl({
		origin: "http://larm.test:9810",
		token: "control-token",
		fetch: async (input, init) => {
			const url = new URL(String(input));
			const seen = {
				method: init?.method ?? "GET",
				path: url.pathname,
				headers: new Headers(init?.headers),
				body: typeof init?.body === "string" ? init.body : undefined,
			};
			calls.push(seen);
			return respond(seen);
		},
	});
	return { calls, training: createTrainingClient(control) };
}

describe("training client", () => {
	test("registerDataset posts JSONL with bearer and Idempotency-Key", async () => {
		const { calls, training } = client(() =>
			Response.json({ id: "ds-1" }, { status: 201 }),
		);
		expect(await training.registerDataset('{"a":1}\n{"a":2}\n', "key-1")).toBe(
			"ds-1",
		);
		const call = calls[0];
		expect(call?.method).toBe("POST");
		expect(call?.path).toBe("/v1/decision/datasets");
		expect(call?.headers.get("authorization")).toBe("Bearer control-token");
		expect(call?.headers.get("idempotency-key")).toBe("key-1");
		expect(call?.headers.get("content-type")).toBe("application/x-ndjson");
		expect(call?.body).toBe('{"a":1}\n{"a":2}\n');
	});

	test("startTraining returns the jobId from a 202", async () => {
		const { calls, training } = client(() =>
			Response.json({ jobId: "job-1" }, { status: 202 }),
		);
		const jobId = await training.startTraining({
			model: "m",
			datasetId: "ds-1",
			questionSet: {
				id: "qs",
				version: 1,
				questions: { q: { type: "noul", instructions: "x" } },
			},
		});
		expect(jobId).toBe("job-1");
		expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
			model: "m",
			datasetId: "ds-1",
		});
		expect(calls[0]?.headers.get("idempotency-key")).toBeTruthy();
	});

	test("getJob / listAdapters / deletes use the documented paths", async () => {
		const { calls, training } = client((seen) =>
			seen.method === "DELETE"
				? new Response(null, { status: 204 })
				: Response.json({ status: "running" }),
		);
		await training.getJob("j/1");
		await training.listAdapters();
		await training.deleteAdapter("ad", 3);
		await training.deleteDataset("ds-1");
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /v1/decision/training-jobs/j%2F1",
			"GET /v1/decision/adapters",
			"DELETE /v1/decision/adapters/ad/versions/3",
			"DELETE /v1/decision/datasets/ds-1",
		]);
		expect(calls[2]?.headers.get("idempotency-key")).toBeTruthy();
	});

	test("rejects unexpected statuses and bodies", async () => {
		const failing = client(() =>
			Response.json(
				{ error: { code: "decision_training_busy" } },
				{ status: 429 },
			),
		);
		await expect(failing.training.getJob("x")).rejects.toMatchObject({
			code: "larm_control_429",
			remoteCode: "decision_training_busy",
		});
		const odd = client(() => Response.json([1, 2]));
		await expect(odd.training.listAdapters()).rejects.toThrow(
			"larm_invalid_contract",
		);
	});
});
