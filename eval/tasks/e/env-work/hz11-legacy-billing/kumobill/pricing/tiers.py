"""Overage pricing (docs/pricing.md)."""
from kumobill.model.plan import Plan


def overage_charge(plan: Plan, units: int) -> int:
    """Overage over the included units, priced at the rate of the tier the overage reaches."""
    over = max(0, units - plan.included_units)
    reached = 0
    rate = plan.tiers[0][1]
    for width, tier_rate in plan.tiers:
        rate = tier_rate
        if width is None or over <= reached + width:
            break
        reached += width
    return over * rate
