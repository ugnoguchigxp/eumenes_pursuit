import type {
	ConsultationRow,
	PursuitView,
	StrategyRow,
} from "../ledger/types.ts";

export interface UnfinishedPart {
	readonly part: number;
	readonly text: string;
	readonly status: "blocked" | "untried";
	readonly next: string;
}

/**
 * Parts not yet worked through (spec/persistence-design.md §2): untried, blocked
 * with a next move, or never assessed. Done parts and blocked ones with no next
 * move count as finished.
 */
export function unfinishedParts(strategy: StrategyRow): UnfinishedPart[] {
	return strategy.parts.flatMap((text, i): UnfinishedPart[] => {
		const a = strategy.assessment?.find((x) => x.part === i + 1);
		if (!a) return [{ part: i + 1, text, status: "untried", next: "" }];
		if (a.status === "done") return [];
		if (a.status === "blocked" && !a.next.trim()) return [];
		return [{ part: i + 1, text, status: a.status, next: a.next }];
	});
}

export function describeUnfinished(parts: readonly UnfinishedPart[]): string {
	return parts
		.map(
			(p) =>
				`部品${p.part}（${p.text}）: ${p.status === "untried" ? "未着手" : `詰まり、次の一手: ${p.next}`}`,
		)
		.join(" / ");
}

/** True when an answered consultation has had no executed attempt since its answer. */
export function consultedWithoutProgress(view: PursuitView): boolean {
	const answered = view.consultations.filter(
		(c): c is ConsultationRow & { answeredAt: number } => c.answeredAt !== null,
	);
	const last = answered.at(-1);
	if (!last) return false;
	return !view.attempts.some(
		(a) =>
			(a.state === "settled" || a.state === "interrupted") &&
			a.startedAt >= last.answeredAt,
	);
}
