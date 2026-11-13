import sys
from math import exp, log, sqrt

LN10 = log(10.0)


def solve_linear(a, b):
    n = len(b)
    a = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        pivot = max(range(c, n), key=lambda r: abs(a[r][c]))
        a[c], a[pivot] = a[pivot], a[c]
        for r in range(c + 1, n):
            factor = a[r][c] / a[c][c]
            for k in range(c, n + 1):
                a[r][k] -= factor * a[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (a[r][n] - sum(a[r][k] * x[k] for k in range(r + 1, n))) / a[r][r]
    return x


def speciate(totals, species, solids, present, x):
    """Newton iteration on x = ln(free concentration) with the listed solids at saturation."""
    nc = len(totals)
    rows = sorted(present)
    amounts = [0.0] * len(rows)
    for _ in range(20000):
        conc = [exp(k + sum(v * xi for v, xi in zip(nu, x))) for k, nu in species]
        size = nc + len(rows)
        matrix = [[0.0] * size for _ in range(size)]
        rhs = [0.0] * size
        for i in range(nc):
            rhs[i] = totals[i] - sum(c * nu[i] for c, (_, nu) in zip(conc, species))
            for j in range(nc):
                matrix[i][j] = sum(c * nu[i] * nu[j] for c, (_, nu) in zip(conc, species))
        for r, p in enumerate(rows):
            k, mu = solids[p]
            rhs[nc + r] = -(k + sum(m * xi for m, xi in zip(mu, x)))
            for i in range(nc):
                matrix[nc + r][i] = matrix[i][nc + r] = mu[i]
        solution = solve_linear(matrix, rhs)
        step = solution[:nc]
        amounts = solution[nc:]
        longest = max(map(abs, step))
        if longest < 1e-12:
            break
        # Small steps keep the iteration from overshooting.
        damping = min(1.0, 0.05 / longest)
        x = [xi + damping * d for xi, d in zip(x, step)]
    return x, dict(zip(rows, amounts))


def solve(totals, charges, species, solids, davies):
    nc = len(totals)
    unit = [[float(i == j) for j in range(nc)] for i in range(nc)]
    stoich = unit + [nu for _, nu in species]
    constants = [0.0] * nc + [k * LN10 for k, _ in species]
    limits = [(k * LN10, mu) for k, mu in solids]
    x = [-7.0 * LN10] + [log(t) - 2.0 for t in totals[1:]]

    def with_solids(model, x):
        # Add the most supersaturated solid until none is left.
        present = set()
        while True:
            x, amounts = speciate(totals, model, limits, present, x)
            index = {
                p: k + sum(m * xi for m, xi in zip(mu, x))
                for p, (k, mu) in enumerate(limits)
                if p not in present
            }
            worst = max(index, key=index.get, default=None)
            if worst is None or index[worst] <= 1e-9:
                return x, amounts
            present.add(worst)

    model = list(zip(constants, stoich))
    x, amounts = with_solids(model, x)
    if davies:
        # Correct the constants with the ionic strength of the ideal solution.
        z = [sum(n * c for n, c in zip(nu, charges)) for nu in stoich]
        conc = [exp(k + sum(n * xi for n, xi in zip(nu, x))) for k, nu in model]
        ionic = 0.5 * sum(c * q * q for c, q in zip(conc, z))
        root = sqrt(ionic)
        gamma = [-0.509 * q * q * (root / (1 + root) - 0.3 * ionic) * LN10 for q in z]
        model = [
            (k - gamma[j] + sum(n * gamma[i] for i, n in enumerate(nu)), nu)
            for j, (k, nu) in enumerate(model)
        ]
        x, amounts = with_solids(model, x)
    return [xi / LN10 for xi in x], [max(amounts.get(p, 0.0), 0.0) for p in range(len(solids))]


def main():
    tokens = sys.stdin.read().split()
    position = 0

    def take(count, kind=float):
        nonlocal position
        out = [kind(t) for t in tokens[position : position + count]]
        position += count
        return out

    for _ in range(take(1, int)[0]):
        nc, ns, np_, model = take(4, int)
        totals = take(nc)
        charges = take(nc, int)
        species = [(take(1)[0], take(nc, int)) for _ in range(ns)]
        solids = [(take(1)[0], take(nc, int)) for _ in range(np_)]
        logs, amounts = solve(totals, charges, species, solids, model == 1)
        print(
            " ".join(
                ["%.5f" % v for v in logs]
                + ["%.5e" % v if v > 0 else "0" for v in amounts]
            )
        )


if __name__ == "__main__":
    main()
