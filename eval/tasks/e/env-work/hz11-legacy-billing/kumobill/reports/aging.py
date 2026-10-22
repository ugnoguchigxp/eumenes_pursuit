"""Receivables aging buckets (not used by the CLI)."""
from datetime import timedelta

BUCKETS = (30, 60, 90)


def bucket(invoice, today):
    """Days past the due date (last day + 14 days), as a bucket label."""
    due = invoice.last_day + timedelta(days=14)
    late = (today - due).days
    if late <= 0:
        return "current"
    for b in BUCKETS:
        if late <= b:
            return f"<= {b}"
    return f"> {BUCKETS[-1]}"
