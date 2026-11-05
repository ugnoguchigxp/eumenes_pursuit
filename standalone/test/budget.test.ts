import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSettings } from "../settings.ts";
import type { UsageCall } from "../usage.ts";
const call = (id: string): UsageCall => ({
	callId: id,
	provider: "openai",
	requestedModel: "m",
	latencyMs: 0,
	status: "response",
});
const scope = (jobId = "j") => ({
	runId: "r",
	configId: "fixture",
	jobId,
	pursuitId: null,
	budgetId: "campaign",
});
function setup(path = ":memory:") {
	const s = openSettings(path);
	s.set("spend.limitUsd", 1);
	s.set("spend.pricing", { m: { input: 1, output: 1 } });
	return s;
}

test("reservations block overspend before dispatch, and known usage settles exactly once", () => {
	const s = setup();
	try {
		const a = s.meter(scope("a")),
			b = s.meter(scope("b"));
		a.reserve(call("a"), 0.75);
		expect(() => b.reserve(call("b"), 0.75)).toThrow("spend_limit");
		a.dispatch("a");
		expect(() => a.release("a")).toThrow("uncertain");
		a.record("m", { input_tokens: 500000, output_tokens: 0 }, call("a"));
		a.record("m", { input_tokens: 500000, output_tokens: 0 }, call("a"));
		expect(s.exposureUsd()).toBe(0.5);
		expect(s.meter().events()).toHaveLength(1);
		b.reserve(call("b"), 0.5);
		b.release("b");
		expect(s.exposureUsd()).toBe(0.5);
	} finally {
		s.close();
	}
});

test("campaign and provider limits include in-flight calls across distinct jobs", () => {
	const s = setup();
	try {
		s.setBudget("campaign:campaign", 0.8);
		s.setBudget("campaign:campaign:provider:openai", 0.6);
		const a = s.meter(scope("a"));
		a.reserve(call("a"), 0.6);
		expect(() => s.meter(scope("b")).reserve(call("b"), 0.01)).toThrow(
			"spend_limit",
		);
		expect(() => s.setBudget("campaign:campaign", 0.5)).toThrow("exposure");
	} finally {
		s.close();
	}
});

test("crashed dispatch retains its liability on reopen and can be reconciled with an immutable audit", () => {
	const dir = mkdtempSync(join(tmpdir(), "budget-recovery-"));
	const path = join(dir, "settings.sqlite");
	let s = setup(path);
	const a = s.meter(scope());
	a.reserve(call("lost"), 0.8);
	a.dispatch("lost");
	s.close();
	s = openSettings(path);
	try {
		expect(s.exposureUsd()).toBe(0.8);
		expect(() => s.meter().release("lost")).toThrow("uncertain");
		expect(() => s.reconcile("lost", 0.8, "", "proof", "upper_bound")).toThrow(
			"evidence",
		);
		s.reconcile(
			"lost",
			0.8,
			"operator",
			"documented request upper bound",
			"upper_bound",
		);
		expect(s.exposureUsd()).toBe(0.8);
		expect(s.meter().events()[0]?.costStatus).toBe("estimated");
		expect(() =>
			s.reconcile("lost", 0.1, "operator", "different", "invoice"),
		).toThrow();
	} finally {
		s.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("unreserved legacy unknown stays blocked until evidence-based reconciliation, preserving raw facts", () => {
	const s = setup();
	try {
		s.meter().recordUnknown!(call("legacy"));
		expect(s.exposureUsd()).toBe(Infinity);
		expect(() => s.meter(scope()).reserve(call("next"), 0.1)).toThrow();
		s.reconcile("legacy", 0.2, "operator", "invoice record #42", "invoice");
		expect(s.exposureUsd()).toBe(0.2);
		expect(s.meter().events()[0]?.inputTokens).toBeNull();
		s.meter(scope()).reserve(call("next"), 0.8);
		expect(s.exposureUsd()).toBe(1);
	} finally {
		s.close();
	}
});

test("parallel processes cannot both reserve the same remaining budget", async () => {
	const dir = mkdtempSync(join(tmpdir(), "budget-race-")),
		path = join(dir, "settings.sqlite");
	setup(path).close();
	try {
		const results = await Promise.all(
			["a", "b"].map(async (id) => {
				const source = `import {openSettings} from ${JSON.stringify(new URL("../settings.ts", import.meta.url).href)};
const s=openSettings(${JSON.stringify(path)});try {s.meter().reserve({callId:${JSON.stringify(id)},provider:'openai',requestedModel:'m',latencyMs:0,status:'response'},.75);console.log('reserved');}catch{console.log('blocked')}finally{s.close()}`;
				const proc = Bun.spawn([process.execPath, "-e", source], {
					stdout: "pipe",
					stderr: "pipe",
				});
				const out = await new Response(proc.stdout).text();
				expect(await proc.exited).toBe(0);
				return out.trim();
			}),
		);
		expect(results.sort()).toEqual(["blocked", "reserved"]);
		const s = openSettings(path);
		expect(s.exposureUsd()).toBe(0.75);
		s.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reconciliation is idempotent and a made-up zero upper bound is rejected", () => {
	const s = setup();
	try {
		s.meter().recordUnknown!(call("u"));
		expect(() =>
			s.reconcile("u", 0, "operator", "assumption", "upper_bound"),
		).toThrow("positive");
		s.reconcile("u", 0.2, "operator", "bounded request", "upper_bound");
		s.reconcile("u", 0.2, "operator", "bounded request", "upper_bound");
		expect(s.exposureUsd()).toBe(0.2);
	} finally {
		s.close();
	}
});
