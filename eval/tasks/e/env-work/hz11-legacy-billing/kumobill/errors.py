class BillingError(Exception):
    """A request that cannot be billed (bad input, unknown plan)."""
