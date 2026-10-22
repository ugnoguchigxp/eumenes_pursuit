"""CSV export of invoices for the accounting system (not used by the CLI).

Note: the accounting system wants amounts rounded to 10 yen; that rounding happens there,
not here and not in the invoices.
"""
import csv
import io

FIELDS = ["account", "start", "last_day", "plan", "base", "overage", "discount", "tax", "credit", "total", "carry"]


def to_csv(invoices) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(FIELDS)
    for inv in invoices:
        w.writerow([getattr(inv, f) for f in FIELDS])
    return buf.getvalue()
