"""Prepaid credit balance (docs/discounts.md, "前払いクレジット")."""


class CreditBalance:
    def __init__(self, yen: int):
        self.yen = yen

    def apply(self, amount: int) -> int:
        """Use the balance against `amount`; returns the yen used."""
        return min(self.yen, amount)
