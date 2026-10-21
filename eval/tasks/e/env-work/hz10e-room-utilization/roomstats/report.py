"""CSV in, per-room utilization out."""

import csv
import io

from .intervals import covered
from .timeparse import clip, to_minutes

OPEN = to_minutes("08:00")
CLOSE = to_minutes("20:00")
OPEN_MINUTES = CLOSE - OPEN


def parse(text: str) -> dict[str, list[tuple[int, int]]]:
    rooms: dict[str, list[tuple[int, int]]] = {}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        start, end = to_minutes(row["start"]), to_minutes(row["end"])
        if start >= end:
            raise ValueError(f"empty booking: {row}")
        rooms.setdefault(row["room"].strip(), []).append((start, end))
    return rooms


def percent(busy: int) -> str:
    return f"{round(busy / OPEN_MINUTES * 100, 1):.1f}"


def render(text: str) -> str:
    lines = []
    for room, bookings in sorted(parse(text).items()):
        inside = [iv for iv in (clip(s, e, OPEN, CLOSE) for s, e in bookings) if iv]
        busy = covered(inside)
        lines.append(f"{room}\t{busy}\t{percent(busy)}")
    return "".join(line + "\n" for line in lines)
