"""Date helpers."""
import calendar
from datetime import date

from kumobill.errors import BillingError


def parse_date(text: str) -> date:
    try:
        y, m, d = (int(x) for x in text.split("-"))
        return date(y, m, d)
    except (ValueError, AttributeError) as e:
        raise BillingError(f"bad date {text!r}") from e


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def add_months(day: date, months: int, anchor_day: int) -> date:
    """`months` months after `day`'s month, on `anchor_day` clamped to that month's length."""
    total = day.year * 12 + (day.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    return date(year, month, min(anchor_day, days_in_month(year, month)))
