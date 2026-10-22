from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Usage:
    account: str
    day: date
    units: int
