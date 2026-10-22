"""Anniversary billing cycles (docs/cycles.md)."""
from datetime import date, timedelta
from typing import Iterator, Tuple

from kumobill.cycles.dates import add_months


def cycles(anchor: date, count: int) -> Iterator[Tuple[date, date]]:
    """(start, end) of each cycle; `end` is the next cycle's start (exclusive)."""
    start = anchor
    for _ in range(count):
        # The next cycle starts one month after this cycle's start.
        end = add_months(start, 1, start.day)
        yield start, end
        start = end


def last_day(end: date) -> date:
    return end - timedelta(days=1)
