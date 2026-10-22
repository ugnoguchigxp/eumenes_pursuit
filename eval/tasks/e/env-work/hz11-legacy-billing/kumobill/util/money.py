"""Yen rounding. Amounts are exact fractions until they are rounded here."""
from fractions import Fraction
import math


def round_half_up(x: Fraction) -> int:
    """Nearest yen; exactly half a yen goes up (amounts are never negative here)."""
    return math.floor(x + Fraction(1, 2))


def floor_yen(x) -> int:
    return math.floor(x)
