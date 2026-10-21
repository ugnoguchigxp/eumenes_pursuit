import unittest

from build import ranking


class RankingTest(unittest.TestCase):
    def test_distinct_totals(self):
        self.assertEqual(
            ranking({"north": 60, "south": 75, "east": 10}),
            [(1, "south", 75), (2, "north", 60), (3, "east", 10)],
        )

    def test_single(self):
        self.assertEqual(ranking({"x": 1}), [(1, "x", 1)])


if __name__ == "__main__":
    unittest.main()
