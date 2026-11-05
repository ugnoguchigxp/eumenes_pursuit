import { createClaudeLlm } from "./claude.ts";
import { createOpenAiLlm } from "./openai.ts";
import type { SettingValue } from "./settings.ts";
import type { UsageMeter } from "./usage.ts";

/** Provider selection is explicit host configuration, never inferred from a model's name. */
export function createRoleLlm(
	role: SettingValue<"llm.generator">,
	meter: UsageMeter,
) {
	return role.provider === "openai"
		? createOpenAiLlm(role, meter)
		: createClaudeLlm(role, meter);
}
