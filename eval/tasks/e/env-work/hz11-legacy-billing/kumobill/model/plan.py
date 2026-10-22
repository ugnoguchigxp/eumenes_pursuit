from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class Plan:
    code: str
    base_yen: int
    included_units: int
    # (width, rate): `width` units at `rate` yen each; width None = all remaining units.
    tiers: List[Tuple[Optional[int], int]]
