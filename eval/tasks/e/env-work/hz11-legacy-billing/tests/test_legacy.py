import unittest
from datetime import date

from kumobill.catalog.legacy import resolve


class LegacyTest(unittest.TestCase):
    def test_fixed_codes(self):
        self.assertEqual(resolve("PRO", date(2025, 5, 1)), "pro-2025")
        self.assertEqual(resolve("STD", date(2025, 5, 1)), "starter-2025")
        self.assertEqual(resolve("team-2025", date(2025, 5, 1)), "team-2025")


if __name__ == "__main__":
    unittest.main()
