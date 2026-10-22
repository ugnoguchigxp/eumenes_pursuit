import unittest
from datetime import date

from kumobill.cycles.anniversary import cycles, last_day


class CycleTest(unittest.TestCase):
    def test_mid_month_anchor(self):
        got = [(s, last_day(e)) for s, e in cycles(date(2025, 3, 15), 3)]
        self.assertEqual(
            got,
            [
                (date(2025, 3, 15), date(2025, 4, 14)),
                (date(2025, 4, 15), date(2025, 5, 14)),
                (date(2025, 5, 15), date(2025, 6, 14)),
            ],
        )

    def test_count(self):
        self.assertEqual(len(list(cycles(date(2025, 1, 10), 5))), 5)


if __name__ == "__main__":
    unittest.main()
