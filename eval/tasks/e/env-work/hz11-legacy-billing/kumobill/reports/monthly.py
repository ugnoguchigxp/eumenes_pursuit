"""Monthly revenue summary for the finance team (not used by the CLI).

Groups invoices by the calendar month of their last day. Kept for the old finance export; the
finance team now reads the invoice lines directly.
"""
from collections import defaultdict


def revenue_by_month(invoices):
    out = defaultdict(int)
    for inv in invoices:
        out[inv.last_day.strftime("%Y-%m")] += inv.total + inv.credit
    return dict(sorted(out.items()))
