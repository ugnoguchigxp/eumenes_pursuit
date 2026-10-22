"""Load the plan catalog (data/plans.json)."""
import json
import os

from kumobill.config import CATALOG_FILE
from kumobill.errors import BillingError
from kumobill.model.plan import Plan

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Catalog:
    def __init__(self, plans):
        self._plans = plans

    def get(self, code: str) -> Plan:
        if code not in self._plans:
            raise BillingError(f"unknown plan {code}")
        return self._plans[code]

    def codes(self):
        return sorted(self._plans)


def load_catalog(path: str = None) -> Catalog:
    path = path or os.path.join(ROOT, CATALOG_FILE)
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    plans = {}
    for code, p in raw["plans"].items():
        tiers = [(t["width"], int(t["rate"])) for t in p["tiers"]]
        plans[code] = Plan(code, int(p["base_yen"]), int(p["included_units"]), tiers)
    return Catalog(plans)
