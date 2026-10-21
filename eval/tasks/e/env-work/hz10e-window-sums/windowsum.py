"""Per-event sum of the same user's amounts over the preceding hour."""

import sys

WINDOW = 3600


def window_sums(events: list[tuple[int, str, int]]) -> list[int]:
    out = []
    for t, user, _ in events:
        total = 0
        for t2, user2, amount2 in events:
            if user2 == user and t - WINDOW < t2 <= t:
                total += amount2
        out.append(total)
    return out


def parse(text: str) -> list[tuple[int, str, int]]:
    lines = text.split("\n")
    n = int(lines[0])
    events = []
    for line in lines[1 : n + 1]:
        t, user, amount = line.split()
        events.append((int(t), user, int(amount)))
    return events


def main() -> None:
    events = parse(sys.stdin.read())
    sys.stdout.write("".join(f"{s}\n" for s in window_sums(events)))


if __name__ == "__main__":
    main()
