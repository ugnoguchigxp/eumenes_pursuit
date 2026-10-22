import type { JudgePort } from "../src/index.ts";
import type { UsageMeter } from "./claude.ts";

/** Wrap inside serialJudge so each actual request (including a retry) is attributed. */
export function meterJudge(
	port: JudgePort,
	meter: UsageMeter,
	profile = "larm-profile",
): JudgePort {
	return {
		maxQuestions: port.maxQuestions,
		async ask(request, signal) {
			const callId = crypto.randomUUID();
			const started = performance.now();
			try {
				const r = await port.ask(request, signal);
				meter.recordExternal?.(
					{
						callId,
						provider: "larm",
						requestedModel: profile,
						latencyMs: performance.now() - started,
						status: "ok",
					},
					{ model: r.model, inputTokens: r.inputTokens, outputTokens: 0 },
				);
				return r;
			} catch (error) {
				meter.recordUnknown?.({
					callId,
					provider: "larm",
					requestedModel: profile,
					latencyMs: performance.now() - started,
					status: "error",
				});
				throw error;
			}
		},
	};
}
