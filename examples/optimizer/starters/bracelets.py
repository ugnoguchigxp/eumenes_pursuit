import sys
from math import gcd


def multiply(x, y, m):
    k = len(x)
    return [
        [sum(x[i][t] * y[t][j] for t in range(k)) % m for j in range(k)]
        for i in range(k)
    ]


def closed_walks(a, length, m):
    k = len(a)
    power = [[int(i == j) for j in range(k)] for i in range(k)]
    for _ in range(length):
        power = multiply(power, a, m)
    return sum(power[i][i] for i in range(k)) % m


def open_walks(a, length, m, first_loop, last_loop):
    k = len(a)
    ways = [a[i][i] if first_loop else 1 for i in range(k)]
    for _ in range(length):
        ways = [sum(ways[i] * a[i][j] for i in range(k)) % m for j in range(k)]
    return sum(ways[j] * (a[j][j] if last_loop else 1) for j in range(k)) % m


def solve(n, m, a):
    # Burnside's lemma over the n rotations and the n reflections.
    total = 0
    for shift in range(n):
        total += closed_walks(a, gcd(shift, n), m)
    if n % 2:
        total += n * open_walks(a, (n - 1) // 2, m, False, True)
    else:
        total += n // 2 * open_walks(a, n // 2, m, False, False)
        total += n // 2 * open_walks(a, n // 2 - 1, m, True, True)
    return total % m * pow(2 * n, -1, m) % m


def main():
    count = int(sys.stdin.readline())
    for _ in range(count):
        n, m, k, *rows = sys.stdin.readline().split()
        a = [[int(c) for c in row] for row in rows]
        print(solve(int(n), int(m), a))


if __name__ == "__main__":
    main()
