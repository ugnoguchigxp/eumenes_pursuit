import unittest
from datetime import date

from kumobill.model.invoice import Invoice
from kumobill.render.text import render_line


class RenderTest(unittest.TestCase):
    def test_line(self):
        inv = Invoice("A9", date(2025, 1, 1), date(2025, 1, 31), "pro-2025", 9800, 0, 0, 980, 0, 10780, 0)
        self.assertEqual(
            render_line(inv),
            "A9 2025-01-01..2025-01-31 plan=pro-2025 base=9800 overage=0 discount=0 tax=980 credit=0 total=10780 carry=0",
        )


if __name__ == "__main__":
    unittest.main()
