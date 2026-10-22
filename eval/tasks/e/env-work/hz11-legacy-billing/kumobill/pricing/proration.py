"""Base fee for a cycle, split by plan changes (docs/pricing.md)."""
from datetime import date, timedelta
from fractions import Fraction

from kumobill.catalog.legacy import resolve
from kumobill.util.money import round_half_up


def segments(account, start: date, end: date):
    """(segment start, segment end, raw plan code) for each plan period inside [start, end)."""
    cuts = [start] + [e.start for e in account.history if start < e.start < end] + [end]
    for a, b in zip(cuts, cuts[1:]):
        yield a, b, account.code_on(a)


# A month counts as 30 days for proration (docs/pricing.md).
DAYS_PER_MONTH = 30


def prorated_base(account, catalog, start: date, end: date, run_date: date) -> int:
    parts = list(segments(account, start, end))
    if len(parts) == 1:
        # No plan change inside the cycle: the whole base fee.
        return catalog.get(resolve(parts[0][2], run_date)).base_yen
    total = 0
    for a, b, code in parts:
        plan = catalog.get(resolve(code, run_date))
        total += round_half_up(Fraction(plan.base_yen * (b - a).days, DAYS_PER_MONTH))
    return total
