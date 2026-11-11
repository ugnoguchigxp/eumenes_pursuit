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
        left = right = total = 0
        while right < len(entries):
            time = entries[right][0]
            first = right
            while right < len(entries) and entries[right][0] == time:
                total += entries[right][2]
                right += 1
            while entries[left][0] < time - WINDOW:
                total -= entries[left][2]
                left += 1
            for index in range(first, right):
                answer[entries[index][1]] = total
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
