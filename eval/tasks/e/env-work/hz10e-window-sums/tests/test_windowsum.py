import unittest

from windowsum import parse, window_sums


class WindowSumTest(unittest.TestCase):
    def test_example(self):
        events = parse("4\n100 u 5\n200 v 7\n3000 u 1\n3800 u 2\n")
        self.assertEqual(window_sums(events), [5, 7, 6, 3])

    def test_unsorted_input(self):
        events = parse("3\n5000 a 1\n1000 a 10\n4000 a 100\n")
        self.assertEqual(window_sums(events), [101, 10, 110])

    def test_window_edge(self):
        events = parse("2\n0 a 1\n3600 a 2\n")
        self.assertEqual(window_sums(events), [1, 2])


if __name__ == "__main__":
    unittest.main()
