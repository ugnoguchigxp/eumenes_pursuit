"""Reproduce the device: one integer per input line."""

import sys


def predict(s: str) -> int:
    return 0  # TODO


def main() -> None:
    for line in sys.stdin.read().split("\n")[:-1]:
        print(predict(line.strip()))


if __name__ == "__main__":
    main()
