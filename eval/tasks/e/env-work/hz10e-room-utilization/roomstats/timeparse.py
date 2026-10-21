"""Clock times as minutes since 00:00."""


def to_minutes(text: str) -> int:
    hours, minutes = text.strip().split(":")
    h, m = int(hours), int(minutes)
    if not (0 <= h <= 24 and 0 <= m < 60) or (h == 24 and m != 0):
        raise ValueError(f"bad time: {text!r}")
    return h * 60 + m


def clip(start: int, end: int, lo: int, hi: int) -> tuple[int, int] | None:
    """The part of [start, end) inside [lo, hi), or None when empty."""
    s, e = max(start, lo), min(end, hi)
    return (s, e) if s < e else None
