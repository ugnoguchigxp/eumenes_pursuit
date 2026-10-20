import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { UsageMeter } from "./claude.ts";

const root = resolve(import.meta.dir, "..");
export const settingsPath = resolve(root, "data/pursuit-settings.sqlite");

const roleSchema = z.strictObject({
	model: z.string().min(1),
	effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
	thinkingHeadroom: z.int().min(0),
});

/** Per-MTok USD. Cache reads/writes are priced from the input rate. */
const priceSchema = z.strictObject({ input: z.number(), output: z.number() });

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
	meter(): UsageMeter & { spentUsd(): number };
	close(): void;
}

export function openSettings(path = settingsPath): Settings {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true, strict: true });
	db.run(`CREATE TABLE IF NOT EXISTS pursuit_setting (
		key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT`);
	db.run(`CREATE TABLE IF NOT EXISTS spend (
		id INTEGER PRIMARY KEY, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
		cache_write_tokens INTEGER NOT NULL, usd REAL NOT NULL, at INTEGER NOT NULL) STRICT`);
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
	const settings: Settings = {
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
		meter() {
			const spentUsd = () =>
				(
					db.query("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend").get() as {
						usd: number;
					}
				).usd;
			return {
				spentUsd,
				assertWithinLimit() {
					const limit = settings.require("spend.limitUsd");
					if (spentUsd() >= limit)
						throw new Error(`spend_limit_reached:${limit}`);
				},
				record(model: string, usage: Anthropic.Usage) {
					const pricing = settings.require("spend.pricing");
					// An unknown served model (e.g. a fallback) is charged at the highest known rate,
					// so the spend limit stays conservative; the call was billed either way.
					const price = pricing[model] ?? {
						input: Math.max(...Object.values(pricing).map((p) => p.input)),
						output: Math.max(...Object.values(pricing).map((p) => p.output)),
					};
					if (!pricing[model])
						console.warn(`[warn] spend_price_missing ${model}`);
					const read = usage.cache_read_input_tokens ?? 0;
					const write = usage.cache_creation_input_tokens ?? 0;
					const usd =
						(usage.input_tokens * price.input +
							write * price.input * 1.25 +
							read * price.input * 0.1 +
							usage.output_tokens * price.output) /
						1_000_000;
					db.query(
						"INSERT INTO spend (model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
					).run(
						model,
						usage.input_tokens,
						usage.output_tokens,
						read,
						write,
						usd,
						Date.now(),
					);
				},
			};
		},
		close: () => db.close(),
	};
	return settings;
}
