import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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

test("Claude provider limits include pre-usage-call spend without double counting", () => {
	const directory = mkdtempSync(join(tmpdir(), "legacy-provider-"));
	const path = join(directory, "settings.sqlite");
	setup(path).close();
	const db = new Database(path);
	db.query(
		"INSERT INTO spend(model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,usd,at) VALUES (?,?,?,?,?,?,?)",
	).run("old-model", 1, 0, 0, 0, 0.4, 1);
	db.close();
	const s = openSettings(path);
	try {
		expect(s.exposureUsd()).toBe(0.4);
		expect(s.exposureUsd("provider:claude")).toBe(0.4);
		expect(() => s.setBudget("provider:claude", 0.3)).toThrow("exposure");
		s.setBudget("provider:claude", 0.5);
		expect(() =>
			s.meter().reserve({ ...call("claude-next"), provider: "claude" }, 0.2),
		).toThrow("spend_limit");
		s.meter().reserve(call("openai-next"), 0.3);
		expect(s.exposureUsd("provider:openai")).toBe(0.3);
		expect(s.exposureUsd()).toBe(0.7);
		expect(s.meter().events()[0]?.provider).toBe("claude");
	} finally {
		s.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

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

test("a reserved unknown stops fresh requests until audited reconciliation", () => {
	const s = setup();
	try {
		const meter = s.meter(scope());
		meter.reserve(call("lost"), 0.4);
		meter.dispatch("lost");
		meter.recordUnknown!(call("lost"));
		expect(s.exposureUsd()).toBe(Infinity);
		expect(() => meter.assertWithinLimit()).toThrow("usage_unknown");
		expect(() => s.meter(scope("next")).reserve(call("next"), 0.1)).toThrow(
			"usage_unknown",
		);
		expect(s.budgetSnapshot().reservations).toHaveLength(1);
		s.reconcile(
			"lost",
			0.4,
			"operator",
			"documented upper bound",
			"upper_bound",
		);
		expect(s.exposureUsd()).toBe(0.4);
		s.meter(scope("next")).reserve(call("next"), 0.6);
		expect(s.exposureUsd()).toBe(1);
		expect(meter.events()[0]?.costStatus).toBe("estimated");
	} finally {
		s.close();
	}
});

test("the input reservation covers every configured billable cache category", () => {
	const s = setup();
	try {
		s.set("spend.limitUsd", 0.00015);
		s.set("spend.pricing", {
			m: { input: 1, output: 1, cacheRead: 2, maxInputTokens: 100 },
		});
		const meter = s.meter(scope());
		expect(meter.upperBound("m", 0)).toBe(0.0002);
		expect(() =>
			meter.reserve(call("cache-read"), meter.upperBound("m", 0)),
		).toThrow("spend_limit");
		expect(s.budgetSnapshot().reservations).toHaveLength(0);
		expect(s.exposureUsd()).toBe(0);
	} finally {
		s.close();
	}
});

test("an invoice above the reserved bound records the real liability and blocks overspend", () => {
	const s = setup();
	try {
		const meter = s.meter(scope());
		meter.reserve(call("underestimated"), 0.4);
		meter.dispatch("underestimated");
		meter.recordUnknown!(call("underestimated"));
		expect(() =>
			s.reconcile(
				"underestimated",
				1.1,
				"operator",
				"provider invoice",
				"upper_bound",
			),
		).toThrow("invalid_reservation_resolution");
		s.reconcile(
			"underestimated",
			1.1,
			"operator",
			"provider invoice",
			"invoice",
		);
		expect(s.exposureUsd()).toBe(1.1);
		expect(meter.events()[0]).toMatchObject({
			usd: 1.1,
			costStatus: "known",
			reconciliation: { kind: "invoice", basis: "provider invoice" },
		});
		expect(s.budgetSnapshot().reservations).toHaveLength(0);
		expect(() => meter.reserve(call("after-invoice"), 0.01)).toThrow(
			"spend_limit",
		);
	} finally {
		s.close();
	}
});

test("a served model without a tariff retains usage and stops fresh dispatch", () => {
	const s = setup();
	try {
		const meter = s.meter(scope());
		meter.reserve(call("unknown-tariff"), 0.4);
		meter.dispatch("unknown-tariff");
		expect(() =>
			meter.record(
				"served-alias",
				{ input_tokens: 100, output_tokens: 20 },
				call("unknown-tariff"),
			),
		).toThrow("pricing_required");
		expect(meter.events()[0]).toMatchObject({
			requestedModel: "m",
			servedModel: "served-alias",
			inputTokens: 100,
			outputTokens: 20,
			usd: null,
			costStatus: "unknown",
		});
		expect(s.exposureUsd()).toBe(Infinity);
		expect(() => meter.reserve(call("after-unknown-tariff"), 0.1)).toThrow(
			"usage_unknown",
		);
	} finally {
		s.close();
	}
});
