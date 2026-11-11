import sys

WINDOW = 3600


def window_sums(events):
    return [
        sum(amount for other, owner, amount in events
            if owner == user and time - WINDOW < other <= time)
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
