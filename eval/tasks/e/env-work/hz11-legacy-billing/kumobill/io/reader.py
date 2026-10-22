"""Parse the JSON billing request into model objects."""
import json

from kumobill.cycles.dates import parse_date
from kumobill.errors import BillingError
from kumobill.io.validate import validate_request
from kumobill.model.account import Account, Coupon, PlanEntry
from kumobill.model.usage import Usage


class Request:
    def __init__(self, run_date, accounts, usage):
        self.run_date = run_date
        self.accounts = accounts
        self.usage = usage


def read_request(text: str) -> Request:
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise BillingError(f"invalid json: {e}") from e
    validate_request(raw)
    accounts = []
    for a in raw["accounts"]:
        history = [PlanEntry(parse_date(p["from"]), p["plan"]) for p in a["plan_history"]]
        history.sort(key=lambda p: p.start)
        coupon = None
        if a.get("coupon"):
            c = a["coupon"]
            coupon = Coupon(c["code"], int(c["percent"]), parse_date(c["from"]), int(c["cycles"]))
        accounts.append(
            Account(
                id=a["id"],
                history=history,
                cycles=int(a["cycles"]),
                coupon=coupon,
                credit_yen=int(a.get("credit_yen", 0)),
                tax_exempt=bool(a.get("tax_exempt", False)),
            )
        )
    usage = [Usage(u["account"], parse_date(u["date"]), int(u["units"])) for u in raw.get("usage", [])]
    return Request(parse_date(raw["run_date"]), accounts, usage)
