"""Coupon discounts (docs/discounts.md)."""
from fractions import Fraction

from kumobill.util.money import round_half_up


def coupon_applies(coupon, cycle_index_from_coupon: int) -> bool:
    return coupon is not None and 0 <= cycle_index_from_coupon < coupon.cycles


def percent_discount(subtotal: int, percent: int) -> int:
    """Percentage of the subtotal, rounded to the nearest yen."""
    return round_half_up(Fraction(subtotal * percent, 100))
