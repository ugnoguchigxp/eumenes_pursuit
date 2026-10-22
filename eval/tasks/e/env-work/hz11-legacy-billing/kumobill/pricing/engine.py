"""One invoice per billing cycle."""
from kumobill.catalog.legacy import resolve
from kumobill.cycles.anniversary import cycles, last_day
from kumobill.model.invoice import Invoice
from kumobill.pricing.credits import CreditBalance
from kumobill.pricing.discounts import coupon_applies, percent_discount
from kumobill.pricing.proration import prorated_base
from kumobill.pricing.tax import consumption_tax
from kumobill.pricing.tiers import overage_charge


def bill_account(account, usage, catalog, run_date):
    balance = CreditBalance(account.credit_yen)
    coupon_cycles = 0
    out = []
    for start, end in cycles(account.start, account.cycles):
        final = last_day(end)
        # Plan codes are resolved against the catalog in force on the run date.
        plan = catalog.get(resolve(account.code_on(final), run_date))
        units = sum(u.units for u in usage if start <= u.day < end)
        base = prorated_base(account, catalog, start, end, run_date)
        overage = overage_charge(plan, units)
        subtotal = base + overage
        # Prepaid credit comes off the subtotal before the discount (docs/discounts.md).
        used = balance.apply(subtotal)
        net = subtotal - used
        discount = 0
        if account.coupon and start >= account.coupon.start:
            if coupon_applies(account.coupon, coupon_cycles):
                discount = percent_discount(net, account.coupon.percent)
            coupon_cycles += 1
        tax = consumption_tax(subtotal, account.tax_exempt)
        total = net - discount + tax
        out.append(Invoice(account.id, start, final, plan.code, base, overage, discount, tax, used, total, balance.yen))
    return out
