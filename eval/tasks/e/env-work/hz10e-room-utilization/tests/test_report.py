import unittest

from roomstats.report import render


class ReportTest(unittest.TestCase):
    def test_basic(self):
        text = "room,start,end\nB,09:00,12:00\nA,08:00,14:00\nB,11:00,13:00\n"
        self.assertEqual(render(text), "A\t360\t50.0\nB\t240\t33.3\n")

    def test_outside_opening_hours(self):
        text = "room,start,end\nC,06:00,09:00\nC,19:00,24:00\n"
        self.assertEqual(render(text), "C\t120\t16.7\n")

    def test_whole_day(self):
        self.assertEqual(render("room,start,end\nD,00:00,24:00\n"), "D\t720\t100.0\n")


if __name__ == "__main__":
    unittest.main()
