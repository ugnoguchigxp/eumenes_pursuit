import type { PursuitEngine, PursuitRuntime } from "../src/index.ts";
import { remainingWallMs } from "../src/domains/rules/checks.ts";

/** One active step only: consultation waiting never retains an old timer. */
export function deadlineSignal(user: AbortSignal, remainingMs: number) {
	const controller = new AbortController();
	const abort = () => controller.abort(user.reason);
	user.addEventListener("abort", abort, { once: true });
	if (user.aborted) abort();
	const timer = setTimeout(
		() => controller.abort(new Error("pursuit_deadline")),
		Math.max(0, remainingMs),
	);
	if (remainingMs <= 0) controller.abort(new Error("pursuit_deadline"));
	return {
		signal: controller.signal,
		dispose() {
			clearTimeout(timer);
			user.removeEventListener("abort", abort);
		},
	};
}

export async function stepWithDeadline(
	engine: PursuitEngine,
	id: string,
	runtime: PursuitRuntime,
	signal: AbortSignal,
) {
	const view = await engine.view(id);
	if (!view) throw new Error(`pursuit_not_found:${id}`);
	const deadline = deadlineSignal(signal, remainingWallMs(view, Date.now()));
	try {
		return await engine.step(id, runtime, deadline.signal);
	} finally {
		deadline.dispose();
	}
}

/** Cancellation also bounds the optional final verification. */
export async function cancelWithDeadline(
	engine: PursuitEngine,
	id: string,
	reason: string,
	runtime: PursuitRuntime,
	signal: AbortSignal,
) {
	const view = await engine.view(id);
	if (!view) throw new Error(`pursuit_not_found:${id}`);
	const deadline = deadlineSignal(signal, remainingWallMs(view, Date.now()));
	try {
		return await engine.cancel(id, reason, runtime, deadline.signal);
	} finally {
		deadline.dispose();
	}
}
