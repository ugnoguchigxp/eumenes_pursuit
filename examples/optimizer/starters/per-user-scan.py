import sys
from collections import defaultdict

WINDOW = 3600


def window_sums(events):
    users = defaultdict(list)
    for time, user, amount in events:
        users[user].append((time, amount))
    return [
        sum(amount for other, amount in users[user]
            if time - WINDOW < other <= time)
        for time, user, _ in events
    ]


def main():
    rows = iter(sys.stdin.buffer)
    count = int(next(rows))
    events = []
    for _ in range(count):
        time, user, amount = next(rows).split()
        events.append((int(time), user, int(amount)))
    sys.stdout.write("".join(f"{amount}\n" for amount in window_sums(events)))


if __name__ == "__main__":
    main()
