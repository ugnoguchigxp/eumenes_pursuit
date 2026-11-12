import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { sandboxAvailable } from "../tools/sandbox.ts";
import { fixedScenario } from "./fixed.ts";

const [destination, option, ...extra] = process.argv.slice(2);
if (
	!destination ||
	(option &&
		option !== "--candidate-state" &&
		option !== "--measurement-summary") ||
	extra.length
)
	throw new Error(
		"usage: bun eval/optimizer/fixed-check.ts <new output directory> [--candidate-state|--measurement-summary]",
	);
if (!sandboxAvailable())
	throw new Error("Linux with bwrap and prlimit is required");
const directory = resolve(destination);
const result = await fixedScenario(
	directory,
	undefined,
	true,
	option === "--candidate-state"
		? "candidate-state"
		: option === "--measurement-summary"
			? "measurement-summary"
			: undefined,
);
await writeFile(
	resolve(directory, "result.json"),
	JSON.stringify(result, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		status: result.status,
		verified: result.verified,
		resumed: result.resumed,
		final: result.final,
		published: result.published,
	}),
);
