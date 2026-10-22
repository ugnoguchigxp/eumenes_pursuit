import type { JudgePort } from "../../src/contracts/judge.ts";
import { pause } from "./control.ts";
import { LarmDecisionError } from "./judge.ts";

/** LARM rejects work that waits in its queue (`queue_timeout`, ~100ms); retry those. */
const retryable = new Set(["queue_timeout", "decision_training_busy"]);

/**
 * One request in flight per process, with jittered retries on queue rejection.
 * The d1 runtime queues for only ~100ms, so concurrent pursuits must take turns here.
 */
export function serialJudge(
	judge: JudgePort,
	options: {
		retries: number;
		baseDelayMs: number;
		queue?: { tail: Promise<unknown> };
	},
): JudgePort {
	const queue = options.queue ?? { tail: Promise.resolve<unknown>(undefined) };
	return {
		maxQuestions: judge.maxQuestions,
		ask(request, signal) {
			const run = async () => {
				for (let attempt = 0; ; attempt++) {
					try {
						return await judge.ask(request, signal);
					} catch (error) {
						const code = error instanceof LarmDecisionError ? error.code : "";
						if (
							!retryable.has(code) ||
							attempt >= options.retries ||
							signal.aborted
						)
							throw error;
						await pause(
							options.baseDelayMs * 2 ** attempt * (0.5 + Math.random()),
							signal,
						);
					}
				}
			};
			const next = queue.tail.then(run, run);
			queue.tail = next.catch(() => undefined);
			return next;
		},
	};
}
