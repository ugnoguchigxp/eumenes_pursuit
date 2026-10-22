from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional


@dataclass(frozen=True)
class PlanEntry:
    """The plan code in effect from `start` (inclusive) until the next entry."""

    start: date
    code: str


@dataclass(frozen=True)
class Coupon:
    code: str
    percent: int
    start: date
    cycles: int


@dataclass
class Account:
    id: str
    history: List[PlanEntry]
    cycles: int
    coupon: Optional[Coupon] = None
    credit_yen: int = 0
    tax_exempt: bool = False
    notes: List[str] = field(default_factory=list)

    @property
    def start(self) -> date:
        """Billing anchor: the first day of the first plan."""
        return self.history[0].start

    def code_on(self, day: date) -> str:
        code = self.history[0].code
        for entry in self.history:
            if entry.start <= day:
                code = entry.code
        return code
