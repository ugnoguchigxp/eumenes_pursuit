import unittest

from roomstats.intervals import covered, merge


class IntervalsTest(unittest.TestCase):
    def test_disjoint(self):
        self.assertEqual(merge([(600, 660), (480, 540)]), [(480, 540), (600, 660)])

    def test_overlap(self):
        self.assertEqual(merge([(480, 600), (540, 660)]), [(480, 660)])
        self.assertEqual(covered([(480, 600), (540, 660)]), 180)

    def test_touching(self):
        self.assertEqual(covered([(480, 540), (540, 600)]), 120)

    def test_empty(self):
        self.assertEqual(merge([]), [])
        self.assertEqual(covered([]), 0)


if __name__ == "__main__":
    unittest.main()
