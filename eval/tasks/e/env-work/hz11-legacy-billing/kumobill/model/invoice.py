from dataclasses import dataclass
from datetime import date


@dataclass
class Invoice:
    account: str
    start: date
    last_day: date
    plan: str
    base: int
    overage: int
    discount: int
    tax: int
    credit: int
    total: int
    carry: int
