"""Reference for the bracelet task: orbits of the dihedral group that contain a valid colouring.

Burnside on U = S ∪ rS (S: colourings valid clockwise, rS: valid counter-clockwise).
A rotation with g cycles fixes 2·tr(A^g) − tr(B^g) members of U, where B = A ∘ Aᵀ.
A colouring fixed by a reflection lies in S exactly when it lies in S ∩ rS, so the
reflections count walks in B. The sum is taken modulo 2nM and divided exactly.
"""

import sys
from math import gcd


def is_prime(n):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def rho(n):
    if n % 2 == 0:
        return 2
    c = 1
    while True:
        x = y = 2
        d = 1
        while d == 1:
            q = 1
            for _ in range(128):
                x = (x * x + c) % n
                y = (y * y + c) % n
                y = (y * y + c) % n
                q = q * abs(x - y) % n
            d = gcd(q, n)
        if d != n:
            return d
        # The batched gcd overshot; retry this constant one step at a time.
        x = y = 2
        d = 1
        while d == 1:
            x = (x * x + c) % n
            y = (y * y + c) % n
            y = (y * y + c) % n
            d = gcd(abs(x - y), n)
        if d != n:
            return d
        c += 1


def factor(n):
    out = {}
    stack = [n]
    while stack:
        m = stack.pop()
        if m == 1:
            continue
        if is_prime(m):
            out[m] = out.get(m, 0) + 1
            continue
        d = None
        for p in (2, 3, 5, 7, 11, 13):
            if m % p == 0:
                d = p
                break
        if d is None:
            d = rho(m)
        stack += [d, m // d]
    return sorted(out.items())


def mul(x, y, w):
    k = len(x)
    return [
        [sum(x[i][t] * y[t][j] for t in range(k)) % w for j in range(k)]
        for i in range(k)
    ]


def power(x, e, w):
    k = len(x)
    out = [[int(i == j) % w for j in range(k)] for i in range(k)]
    while e:
        if e & 1:
            out = mul(out, x, w)
        x = mul(x, x, w)
        e >>= 1
    return out


def solve(n, m, a):
    k = len(a)
    w = 2 * n * m
    b = [[a[i][j] & a[j][i] for j in range(k)] for i in range(k)]
    primes = factor(n)
    total = 0

    # Walk the divisor lattice so that each step is a small matrix power.
    def walk(i, d, pa, pb):
        nonlocal total
        if i == len(primes):
            phi = 1
            rest = n // d
            for p, _ in primes:
                if rest % p == 0:
                    phi *= p - 1
                    rest //= p
                    while rest % p == 0:
                        phi *= p
                        rest //= p
            trace = sum(2 * pa[t][t] - pb[t][t] for t in range(k))
            total = (total + phi * trace) % w
            return
        p, e = primes[i]
        for step in range(e + 1):
            walk(i + 1, d, pa, pb)
            if step < e:
                d *= p
                pa = power(pa, p, w)
                pb = power(pb, p, w)

    walk(0, 1, [row[:] for row in a], [row[:] for row in b])
    if n % 2:
        half = power(b, (n - 1) // 2, w)
        fixed = sum(half[i][j] * b[j][j] for i in range(k) for j in range(k))
        total += n * fixed
    else:
        through_beads = power(b, n // 2, w)
        through_edges = power(b, n // 2 - 1, w)
        fixed = sum(map(sum, through_beads)) + sum(
            b[i][i] * through_edges[i][j] * b[j][j]
            for i in range(k)
            for j in range(k)
        )
        total += n // 2 * fixed
    return total % w // (2 * n)


def solve_circulant(n, m, k, offsets):
    """A[i][j] = 1 exactly when (j - i) mod k is an offset; k may be in the thousands.

    Closed walks of length g number k·[x^0] P(x)^g in Z[x]/(x^k - 1), P = Σ x^d.
    B is the circulant of the offsets d with -d also present; every row of B has
    the same sum, so the reflection terms are powers of that sum. Polynomials are
    multiplied as packed integers (Kronecker substitution).
    """
    w = 2 * n * m
    width = (2 * w.bit_length() + k.bit_length() + 8) // 8

    def multiply(x, y):
        pack = lambda c: int.from_bytes(b"".join(v.to_bytes(width, "little") for v in c), "little")
        raw = (pack(x) * pack(y)).to_bytes(2 * k * width, "little")
        wide = [int.from_bytes(raw[i * width : (i + 1) * width], "little") for i in range(2 * k)]
        return [(wide[i] + wide[i + k]) % w for i in range(k)]

    def power(x, e):
        out = None
        while e:
            if e & 1:
                out = x if out is None else multiply(out, x)
            e >>= 1
            if e:
                x = multiply(x, x)
        return out

    present = set(offsets)
    both = {d for d in present if (k - d) % k in present}
    primes = factor(n)
    total = 0

    def walk(i, d, pa, pb):
        nonlocal total
        if i == len(primes):
            phi = 1
            rest = n // d
            for p, _ in primes:
                if rest % p == 0:
                    phi *= p - 1
                    rest //= p
                    while rest % p == 0:
                        phi *= p
                        rest //= p
            total = (total + phi * k * (2 * pa[0] - (pb[0] if pb else 0))) % w
            return
        p, e = primes[i]
        for step in range(e + 1):
            walk(i + 1, d, pa, pb)
            if step < e:
                d *= p
                pa = power(pa, p)
                pb = power(pb, p) if pb else pb

    indicator = lambda chosen: [int(d in chosen) for d in range(k)]
    walk(0, 1, indicator(present), indicator(both) if both else None)
    degree, loop = len(both), int(0 in present)
    if n % 2:
        total += n * k * pow(degree, (n - 1) // 2, w) * loop
    else:
        total += n // 2 * k * (pow(degree, n // 2, w) + loop * pow(degree, n // 2 - 1, w))
    return total % w // (2 * n)


def answer(line):
    n, m, k, *rest = line.split()
    if rest[0] == "@":
        return solve_circulant(int(n), int(m), int(k), [int(d) for d in rest[1:]])
    a = [[int(c) for c in row] for row in rest]
    assert len(a) == int(k)
    return solve(int(n), int(m), a)


def main():
    rows = sys.stdin.read().split("\n")
    out = []
    for line in rows[1 : 1 + int(rows[0])]:
        out.append(str(answer(line)))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
