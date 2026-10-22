import { expect, test } from "bun:test";
import { deadlineSignal } from "../deadline.ts";
test("deadline aborts a waiting port and cleanup prevents stale timer", async () => {
	const user = new AbortController();
	const d = deadlineSignal(user.signal, 5);
	await new Promise<void>((resolve) =>
		d.signal.addEventListener("abort", () => resolve(), { once: true }),
	);
	expect(d.signal.aborted).toBe(true);
	d.dispose();
	const next = deadlineSignal(user.signal, 5);
	next.dispose();
	await Bun.sleep(15);
	expect(next.signal.aborted).toBe(false);
});
test("user abort and an already expired deadline propagate", () => {
	const user = new AbortController();
	const d = deadlineSignal(user.signal, 10000);
	user.abort("user");
	expect(d.signal.reason).toBe("user");
	d.dispose();
	const expired = deadlineSignal(new AbortController().signal, 0);
	expect(expired.signal.aborted).toBe(true);
	expired.dispose();
});
