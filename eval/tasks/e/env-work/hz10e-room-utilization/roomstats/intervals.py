"""Half-open minute intervals [start, end)."""

Interval = tuple[int, int]


def merge(intervals: list[Interval]) -> list[Interval]:
    """Union of the intervals as disjoint, sorted intervals."""
    merged: list[Interval] = []
    for start, end in sorted(intervals, key=lambda iv: (iv[1], iv[0])):
        if merged and start <= merged[-1][1]:
            last_start, last_end = merged[-1]
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def covered(intervals: list[Interval]) -> int:
    """Minutes covered by at least one interval."""
    return sum(end - start for start, end in merge(intervals))
