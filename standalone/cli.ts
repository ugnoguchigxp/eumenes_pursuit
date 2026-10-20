/**
 * Local settings. Usage:
 *   bun standalone/cli.ts settings init <file.json>   import every key from a JSON file
 *   bun standalone/cli.ts settings set <key> <json>
 *   bun standalone/cli.ts settings show
 *   bun standalone/cli.ts spend
 */
import { readFileSync } from "node:fs";
import { openSettings, settingSchemas, type SettingKey } from "./settings.ts";

const [group, action, ...rest] = process.argv.slice(2);
const settings = openSettings();
const isKey = (key: string): key is SettingKey =>
	Object.hasOwn(settingSchemas, key);
try {
	if (group === "settings" && action === "init" && rest[0]) {
		const values = JSON.parse(readFileSync(rest[0], "utf8")) as Record<
			string,
			unknown
		>;
		for (const [key, value] of Object.entries(values)) {
			if (!isKey(key)) throw new Error(`unknown_setting:${key}`);
			settings.set(key, value);
		}
		if (!settings.get("larm.clientId"))
			settings.set(
				"larm.clientId",
				`eumenes-pursuit-${crypto.getRandomValues(new Uint32Array(2)).join("")}`.slice(
					0,
					40,
				),
			);
		console.log(settings.all());
	} else if (group === "settings" && action === "set" && rest[0] && rest[1]) {
		if (!isKey(rest[0])) throw new Error(`unknown_setting:${rest[0]}`);
		settings.set(rest[0], JSON.parse(rest[1]));
		console.log(settings.all());
	} else if (group === "settings" && action === "show") {
		console.log(settings.all());
	} else if (group === "spend") {
		console.log(
			`spent: $${settings.meter().spentUsd().toFixed(4)} / limit $${settings.get("spend.limitUsd") ?? "unset"}`,
		);
	} else {
		throw new Error(
			"usage: settings init <file> | settings set <key> <json> | settings show | spend",
		);
	}
} finally {
	settings.close();
}
