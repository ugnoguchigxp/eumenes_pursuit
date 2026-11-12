import { candidateTimeoutMs, repeats } from "../../eval/optimizer/benchmark.ts";
import type { Workload } from "../../eval/optimizer/data.ts";

interface Inputs {
	readonly correctness: readonly Workload[];
	readonly speed: readonly Workload[];
}

export function auditBudgetMs(input: Inputs) {
	const runs = input.correctness.length + input.speed.length * (repeats + 1);
	return runs * candidateTimeoutMs + 15000;
}

export async function auditSubmission<T extends { passed: boolean }>(
	load: () => Promise<Inputs>,
	audit: (
		correctness: Inputs["correctness"],
		speed: Inputs["speed"],
		signal: AbortSignal,
	) => Promise<T>,
	parent: AbortSignal,
) {
	let deadline: AbortSignal | undefined;
	try {
		parent.throwIfAborted();
		const inputs = await load();
		deadline = AbortSignal.timeout(auditBudgetMs(inputs));
		const result = await audit(
			inputs.correctness,
			inputs.speed,
			AbortSignal.any([parent, deadline]),
		);
		return {
			status: result.passed ? ("passed" as const) : ("failed" as const),
			result,
		};
	} catch (error) {
		return {
			status: parent.aborted
				? ("interrupted" as const)
				: deadline?.aborted
					? ("timeout" as const)
					: ("error" as const),
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
