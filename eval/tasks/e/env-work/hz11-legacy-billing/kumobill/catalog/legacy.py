"""Plan codes from the old booking system (docs/legacy-codes.md)."""
from datetime import date

# BIZ was the 2024 business plan; from 2025-04-01 the same code means the 2025 business plan.
BIZ_SWITCH = date(2025, 4, 1)

FIXED = {"PRO": "pro-2025", "STD": "starter-2025"}


def resolve(code: str, on: date) -> str:
    """The catalog code that a (possibly legacy) code stands for on day `on`."""
    if code == "BIZ":
        return "business-2024" if on < BIZ_SWITCH else "business-2025"
    return FIXED.get(code, code)
