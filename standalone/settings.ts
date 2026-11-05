import type { UsageScope, UsageCall, UsageEvent } from "./usage.ts";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { shareDatabase } from "./sqlite-shared.ts";
import type { UsageMeter } from "./usage.ts";
import { openBudget } from "./budget.ts";

const root = resolve(import.meta.dir, "..");
export const settingsPath = resolve(root, "data/pursuit-settings.sqlite");

export const roleSchema = z.strictObject({
	provider: z.enum(["claude", "openai"]).default("claude"),
	model: z.string().min(1),
	effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
	thinkingHeadroom: z.int().min(0),
});

/** Per-MTok USD. Cache reads/writes are priced from the input rate. */
const priceSchema = z.strictObject({
	input: z.number().nonnegative(),
	output: z.number().nonnegative(),
	cacheRead: z.number().nonnegative().optional(),
	cacheWrite: z.number().nonnegative().optional(),
	inputLong: z.number().nonnegative().optional(),
	outputLong: z.number().nonnegative().optional(),
	longThreshold: z.int().positive().optional(),
	maxInputTokens: z.int().positive().default(1_050_000),
});

export const settingSchemas = {
	"larm.controlOrigin": z.url(),
	"larm.decisionProfile": z.string().min(1),
	"larm.audience": z.string().min(1),
	"larm.clientId": z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),
	"llm.generator": roleSchema,
	"llm.reviewer": roleSchema,
	"llm.strong": roleSchema,
	/** Hidden examiner for proof tasks (eval only). */
	"llm.grader": roleSchema,
	"spend.limitUsd": z.number().positive(),
	"spend.pricing": z.record(z.string(), priceSchema),
} as const;
export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<
	(typeof settingSchemas)[K]
>;

export interface Settings {
	get<K extends SettingKey>(key: K): SettingValue<K> | undefined;
	require<K extends SettingKey>(key: K): SettingValue<K>;
	set<K extends SettingKey>(key: K, value: unknown): void;
	all(): Record<string, unknown>;
	setBudget(key: string, usd: number): void;
	budgetSnapshot(): ReturnType<ReturnType<typeof openBudget>["snapshot"]>;
	reconcile(
		callId: string,
		usd: number,
		actor: string,
		basis: string,
		kind: "invoice" | "upper_bound",
	): void;
	exposureUsd(key?: string): number;
	meter(
		scope?: UsageScope,
		role?: string,
	): UsageMeter & { spentUsd(): number; events(jobId?: string): UsageEvent[] };
	close(): void;
}

export function openSettings(path = settingsPath): Settings {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true, strict: true });
	// Several runner processes share this file (spend limit and usage).
	shareDatabase(db, path);
	db.run(`CREATE TABLE IF NOT EXISTS pursuit_setting (
		key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT`);
	db.run(`CREATE TABLE IF NOT EXISTS spend (
		id INTEGER PRIMARY KEY, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
		cache_write_tokens INTEGER NOT NULL, usd REAL NOT NULL, at INTEGER NOT NULL) STRICT`);
	db.run(`CREATE TABLE IF NOT EXISTS usage_call (
     call_id TEXT PRIMARY KEY, job_id TEXT, event_json TEXT NOT NULL, spend_id INTEGER UNIQUE REFERENCES spend(id)
    ) STRICT`);
	const get = <K extends SettingKey>(key: K): SettingValue<K> | undefined => {
		const row = db
			.query("SELECT value_json FROM pursuit_setting WHERE key = ?")
			.get(key) as { value_json: string } | null;
		return row
			? (settingSchemas[key].parse(
					JSON.parse(row.value_json),
				) as SettingValue<K>)
			: undefined;
	};
	const budget = openBudget(db, () => get("spend.limitUsd") ?? 0);
	const settings: Settings = {
		setBudget: budget.setLimit,
		budgetSnapshot: budget.snapshot,
		reconcile: budget.reconcile,
		exposureUsd: budget.exposureUsd,
		get,
		require(key) {
			const value = get(key);
			if (value === undefined) throw new Error(`setting_missing:${key}`);
			return value;
		},
		set(key, value) {
			const parsed = settingSchemas[key].parse(value);
			db.query(
				"INSERT INTO pursuit_setting (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
			).run(key, JSON.stringify(parsed), Date.now());
		},
		all() {
			return Object.fromEntries(
				(
					db
						.query("SELECT key, value_json FROM pursuit_setting ORDER BY key")
						.all() as {
						key: string;
						value_json: string;
					}[]
				).map((r) => [r.key, JSON.parse(r.value_json)]),
			);
		},
		meter(scope, role = "unattributed") {
			const spentUsd = () => budget.exposureUsd();
			function save(event: UsageEvent) {
				let withinBound = true;
				// IMMEDIATE: take the write lock before the duplicate check, so a runner that finds the
				// file busy waits (busy_timeout) instead of failing to upgrade a read snapshot that
				// another runner's commit made stale (SQLITE_BUSY_SNAPSHOT is not retried by SQLite).
				db.transaction(() => {
					if (
						db
							.query("SELECT 1 FROM usage_call WHERE call_id = ?")
							.get(event.callId)
					)
						return;
					let spendId: number | null = null;
					if (event.usd !== null) {
						const result = db
							.query(
								"INSERT INTO spend (model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
							)
							.run(
								event.servedModel!,
								event.inputTokens ?? 0,
								event.outputTokens ?? 0,
								event.cacheReadTokens ?? 0,
								event.cacheWriteTokens ?? 0,
								event.usd,
								Date.now(),
							);
						spendId = Number(result.lastInsertRowid);
					}
					db.query(
						"INSERT INTO usage_call (call_id, job_id, event_json, spend_id) VALUES (?, ?, ?, ?)",
					).run(
						event.callId,
						scope?.jobId ?? null,
						JSON.stringify(event),
						spendId,
					);

					if (event.usd !== null)
						withinBound = budget.settle(event.callId, event.usd);
					else budget.uncertain(event.callId);
				}).immediate();
				if (!withinBound) throw new Error("billing_bound_exceeded");
			}
			function metadata(call?: UsageCall): UsageCall {
				return (
					call ?? {
						callId: crypto.randomUUID(),
						requestedModel: "unattributed",
						latencyMs: 0,
						status: "response",
					}
				);
			}
			const priceVersion = () =>
				new Bun.CryptoHasher("sha256")
					.update(
						JSON.stringify(
							Object.entries(settings.require("spend.pricing")).sort(),
						),
					)
					.digest("hex");
			return {
				spentUsd,
				reserve: (call, upperUsd) =>
					budget.reserve(call, scope ? { ...scope } : null, upperUsd),
				dispatch: budget.dispatch,
				release: budget.release,
				upperBound(model, maxOutputTokens) {
					const pricing = settings.require("spend.pricing");
					const p = pricing[model];
					if (!p) {
						const values = Object.values(pricing);
						if (!values.length) throw new Error("pricing_required");
						return Math.max(
							...values.map(
								(v) =>
									(v.maxInputTokens *
										Math.max(v.input, v.inputLong ?? v.input) *
										1.25 +
										maxOutputTokens *
											Math.max(v.output, v.outputLong ?? v.output)) /
									1e6,
							),
						);
					}
					return (
						(p.maxInputTokens *
							Math.max(
								p.input,
								p.inputLong ?? p.input,
								Math.max(p.input, p.inputLong ?? p.input) * 1.25,
								p.cacheWrite ?? 0,
							) +
							maxOutputTokens * Math.max(p.output, p.outputLong ?? p.output)) /
						1e6
					);
				},
				events(jobId) {
					const rows = (
						jobId === undefined
							? db
									.query("SELECT event_json FROM usage_call ORDER BY rowid")
									.all()
							: db
									.query(
										"SELECT event_json FROM usage_call WHERE job_id = ? ORDER BY rowid",
									)
									.all(jobId)
					) as { event_json: string }[];
					const events = rows.map(
						(r) => JSON.parse(r.event_json) as UsageEvent,
					);
					if (jobId === undefined) {
						const legacy = db
							.query(
								"SELECT * FROM spend WHERE id NOT IN (SELECT spend_id FROM usage_call WHERE spend_id IS NOT NULL)",
							)
							.all() as {
							id: number;
							model: string;
							input_tokens: number;
							output_tokens: number;
							cache_read_tokens: number;
							cache_write_tokens: number;
							usd: number;
						}[];
						for (const r of legacy)
							events.push({
								callId: `legacy-${r.id}`,
								requestedModel: "unattributed",
								servedModel: r.model,
								scope: null,
								role: "unattributed",
								inputTokens: r.input_tokens,
								outputTokens: r.output_tokens,
								cacheReadTokens: r.cache_read_tokens,
								cacheWriteTokens: r.cache_write_tokens,
								usd: r.usd,
								pricingVersion: "legacy",
								costStatus: "estimated",
								status: "response",
								latencyMs: 0,
							});
					}
					return budget.resolvedEvents(events);
				},
				assertWithinLimit() {
					const limit = settings.require("spend.limitUsd");
					if (spentUsd() >= limit)
						throw new Error(`spend_limit_reached_or_usage_unknown:${limit}`);
				},
				record(model, usage, call) {
					const pricing = settings.require("spend.pricing");
					const prices = Object.values(pricing);
					const price =
						pricing[model] ??
						(prices.length
							? {
									input: Math.max(...prices.map((p) => p.input)),
									output: Math.max(...prices.map((p) => p.output)),
								}
							: null);
					const totalInput =
						usage.input_tokens +
						(usage.cache_creation_input_tokens ?? 0) +
						(usage.cache_read_input_tokens ?? 0);
					const high =
						price &&
						"longThreshold" in price &&
						totalInput > (price.longThreshold ?? Infinity);
					const inputRate =
						price && high && "inputLong" in price
							? (price.inputLong ?? price.input)
							: price?.input;
					const outputRate =
						price && high && "outputLong" in price
							? (price.outputLong ?? price.output)
							: price?.output;
					const readRate =
						price && "cacheRead" in price
							? high
								? inputRate! * 0.1
								: (price.cacheRead ?? inputRate! * 0.1)
							: inputRate! * 0.1;
					const writeRate =
						price && "cacheWrite" in price
							? high
								? inputRate! * 1.25
								: (price.cacheWrite ?? inputRate! * 1.25)
							: inputRate! * 1.25;
					const counts = [
						usage.input_tokens,
						usage.output_tokens,
						usage.cache_creation_input_tokens ?? 0,
						usage.cache_read_input_tokens ?? 0,
					];
					if (counts.some((n) => !Number.isSafeInteger(n) || n < 0))
						throw new Error("usage_invalid");
					const usd = price
						? (usage.input_tokens * inputRate! +
								(usage.cache_creation_input_tokens ?? 0) * writeRate +
								(usage.cache_read_input_tokens ?? 0) * readRate +
								usage.output_tokens * outputRate!) /
							1e6
						: null;
					save({
						...metadata(call),
						scope: scope ? { ...scope } : null,
						role,
						servedModel: model,
						inputTokens: usage.input_tokens,
						outputTokens: usage.output_tokens,
						reasoningTokens: usage.reasoning_tokens ?? 0,
						cacheReadTokens: usage.cache_read_input_tokens ?? 0,
						cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
						pricingVersion: priceVersion(),
						costStatus: pricing[model]
							? "known"
							: price
								? "estimated"
								: "unknown",
						usd,
					});
				},
				recordExternal(call, info) {
					const price =
						call.provider === "larm"
							? settings.require("spend.pricing")[info.model]
							: undefined;
					const usd = price
						? (info.inputTokens * price.input +
								info.outputTokens * price.output +
								(info.cacheReadTokens ?? 0) * price.input * 0.1) /
							1_000_000
						: null;
					save({
						...call,
						scope: scope ? { ...scope } : null,
						role,
						servedModel: call.provider === "file" ? null : info.model,
						reportedModel: info.model,
						inputTokens: info.inputTokens,
						outputTokens: info.outputTokens,
						cacheReadTokens: info.cacheReadTokens ?? 0,
						cacheWriteTokens: 0,
						pricingVersion: price
							? priceVersion()
							: "external-billing-unavailable",
						costStatus: price ? "known" : "unknown",
						usd,
					});
				},
				recordUnknown(call) {
					save({
						...call,
						scope: scope ? { ...scope } : null,
						role,
						servedModel: null,
						inputTokens: null,
						outputTokens: null,
						cacheReadTokens: null,
						cacheWriteTokens: null,
						pricingVersion: priceVersion(),
						costStatus: "unknown",
						usd: null,
					});
				},
				markStatus(callId, status) {
					db.query(
						"UPDATE usage_call SET event_json = json_set(event_json, '$.status', ?) WHERE call_id = ?",
					).run(status, callId);
				},
			};
		},
		close: () => db.close(),
	};
	return settings;
}
