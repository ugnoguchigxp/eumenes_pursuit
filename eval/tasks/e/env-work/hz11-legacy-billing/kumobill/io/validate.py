"""Shape checks for a billing request. Values are checked again where they are used."""
from kumobill.errors import BillingError

REQUIRED_ACCOUNT = ("id", "plan_history", "cycles")


def validate_request(raw) -> None:
    if not isinstance(raw, dict):
        raise BillingError("request must be an object")
    for key in ("run_date", "accounts"):
        if key not in raw:
            raise BillingError(f"missing {key}")
    for a in raw["accounts"]:
        for key in REQUIRED_ACCOUNT:
            if key not in a:
                raise BillingError(f"account missing {key}")
        if not a["plan_history"]:
            raise BillingError(f"account {a['id']}: empty plan history")
        if int(a["cycles"]) < 1:
            raise BillingError(f"account {a['id']}: cycles must be positive")
    for u in raw.get("usage", []):
        if int(u["units"]) < 0:
            raise BillingError("usage units must not be negative")
