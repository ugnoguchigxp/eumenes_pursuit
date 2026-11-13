"""Correct but slow: exact integers and one Burnside term per rotation."""

import sys
from math import gcd


def mul(x, y):
    k = len(x)
    return [[sum(x[i][t] * y[t][j] for t in range(k)) for j in range(k)] for i in range(k)]


def solve(n, m, a):
    k = len(a)
    b = [[a[i][j] & a[j][i] for j in range(k)] for i in range(k)]
    identity = [[int(i == j) for j in range(k)] for i in range(k)]
    powers_a, powers_b = [identity], [identity]
    for _ in range(n):
        powers_a.append(mul(powers_a[-1], a))
        powers_b.append(mul(powers_b[-1], b))
    total = 0
    for shift in range(n):
        g = gcd(shift, n)
        total += sum(2 * powers_a[g][t][t] - powers_b[g][t][t] for t in range(k))
    if n % 2:
        half = powers_b[(n - 1) // 2]
        total += n * sum(half[i][j] * b[j][j] for i in range(k) for j in range(k))
    else:
        beads, edges = powers_b[n // 2], powers_b[n // 2 - 1]
        total += n // 2 * (
            sum(map(sum, beads))
            + sum(b[i][i] * edges[i][j] * b[j][j] for i in range(k) for j in range(k))
        )
    return total // (2 * n) % m


def main():
    rows = sys.stdin.read().split("\n")
    out = []
    for line in rows[1 : 1 + int(rows[0])]:
        n, m, _, *bits = line.split()
        out.append(str(solve(int(n), int(m), [[int(c) for c in row] for row in bits])))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
