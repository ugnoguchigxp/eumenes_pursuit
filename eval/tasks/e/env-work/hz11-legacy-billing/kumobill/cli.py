"""Command line entry: read a billing request (JSON) on stdin, print one line per cycle."""
import sys

from kumobill.catalog.loader import load_catalog
from kumobill.errors import BillingError
from kumobill.io.reader import read_request
from kumobill.pricing.engine import bill_account
from kumobill.render.text import render_line


def main(argv=None) -> int:
    try:
        request = read_request(sys.stdin.read())
        catalog = load_catalog()
        for account in request.accounts:
            usage = [u for u in request.usage if u.account == account.id]
            for invoice in bill_account(account, usage, catalog, request.run_date):
                print(render_line(invoice))
    except BillingError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0
