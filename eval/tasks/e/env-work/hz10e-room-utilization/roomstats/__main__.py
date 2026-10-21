import sys

from .report import render


def main() -> None:
    sys.stdout.write(render(sys.stdin.read()))


main()
