import unittest

from kumobill.catalog.loader import load_catalog
from kumobill.pricing.tiers import overage_charge


class TierTest(unittest.TestCase):
    def setUp(self):
        self.catalog = load_catalog()

    def test_within_included(self):
        self.assertEqual(overage_charge(self.catalog.get("starter-2025"), 80), 0)

    def test_first_tier(self):
        self.assertEqual(overage_charge(self.catalog.get("starter-2025"), 150), 50 * 12)
        self.assertEqual(overage_charge(self.catalog.get("pro-2025"), 1400), 400 * 8)


if __name__ == "__main__":
    unittest.main()
