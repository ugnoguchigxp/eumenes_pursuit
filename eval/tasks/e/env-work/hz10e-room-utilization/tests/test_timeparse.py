import unittest

from roomstats.timeparse import clip, to_minutes


class TimeParseTest(unittest.TestCase):
    def test_minutes(self):
        self.assertEqual(to_minutes("00:00"), 0)
        self.assertEqual(to_minutes("08:30"), 510)
        self.assertEqual(to_minutes("24:00"), 1440)

    def test_bad(self):
        for bad in ["25:00", "24:01", "7:60", "ab:cd"]:
            with self.assertRaises(ValueError):
                to_minutes(bad)

    def test_clip(self):
        self.assertEqual(clip(400, 500, 480, 1200), (480, 500))
        self.assertIsNone(clip(1200, 1300, 480, 1200))


if __name__ == "__main__":
    unittest.main()
