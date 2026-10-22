"""Consumption tax (docs/tax.md)."""
from kumobill.config import TAX_RATE
from kumobill.util.money import floor_yen


def consumption_tax(taxable: int, exempt: bool) -> int:
    if exempt:
        return 0
    return floor_yen(taxable * TAX_RATE)
