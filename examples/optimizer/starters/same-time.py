import sys
from collections import defaultdict

WINDOW = 3600


def window_sums(events):
    users = defaultdict(list)
    for index, (time, user, amount) in enumerate(events):
        users[user].append((time, index, amount))
    answer = [0] * len(events)
    for entries in users.values():
        entries.sort()
        left = total = 0
        for time, index, amount in entries:
            total += amount
            while entries[left][0] <= time - WINDOW:
                total -= entries[left][2]
                left += 1
            answer[index] = total
    return answer


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
