"""Reference for the aqueous equilibrium task: speciation with optional precipitates.

With x_i = ln(free concentration of component i), the equilibrium of an ideal
solution minimises the convex function
    f(x) = Σ_j exp(κ_j + ν_j·x) - T·x
subject to the saturation limits μ_p·x + κ_p ≤ 0 of the solids. The multiplier of
a limit is the amount of that solid. A primal active-set Newton method solves it;
activity coefficients (Davies) are folded into κ by a fixed-point iteration.
"""

import sys
from math import exp, log, sqrt

LN10 = log(10.0)
DAVIES_A = 0.509


def solve_linear(a, b):
    n = len(b)
    a = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        pivot = max(range(c, n), key=lambda r: abs(a[r][c]))
        if abs(a[pivot][c]) < 1e-300:
            raise ArithmeticError("singular")
        a[c], a[pivot] = a[pivot], a[c]
        top = a[c]
        for r in range(c + 1, n):
            factor = a[r][c] / top[c]
            if factor:
                row = a[r]
                for k in range(c, n + 1):
                    row[k] -= factor * top[k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (a[r][n] - sum(a[r][k] * x[k] for k in range(r + 1, n))) / a[r][r]
    return x


def minimise(totals, species, solids, x, active):
    """species: (κ, ν) including the free components; solids: (κ, μ). Returns x, amounts."""
    nc = len(totals)

    def state(x):
        conc = [exp(min(k + sum(v * xi for v, xi in zip(nu, x)), 600.0)) for k, nu in species]
        value = sum(conc) - sum(t * xi for t, xi in zip(totals, x))
        return conc, value

    def slack(p, x):
        k, mu = solids[p]
        return k + sum(m * xi for m, xi in zip(mu, x))

    conc, value = state(x)
    for _ in range(4000):
        grad = [-t for t in totals]
        scale = [abs(t) for t in totals]
        hess = [[0.0] * nc for _ in range(nc)]
        for c, (_, nu) in zip(conc, species):
            for i in range(nc):
                if nu[i]:
                    grad[i] += c * nu[i]
                    scale[i] += c * abs(nu[i])
                    for j in range(nc):
                        if nu[j]:
                            hess[i][j] += c * nu[i] * nu[j]
        norm = [1.0 / sqrt(hess[i][i]) for i in range(nc)]
        rows = sorted(active)
        size = nc + len(rows)
        kkt = [[0.0] * size for _ in range(size)]
        rhs = [0.0] * size
        for i in range(nc):
            rhs[i] = -grad[i] * norm[i]
            for j in range(nc):
                kkt[i][j] = hess[i][j] * norm[i] * norm[j]
        for r, p in enumerate(rows):
            mu = solids[p][1]
            for i in range(nc):
                kkt[nc + r][i] = kkt[i][nc + r] = mu[i] * norm[i]
        solution = solve_linear(kkt, rhs)
        step = [solution[i] * norm[i] for i in range(nc)]
        amounts = solution[nc:]
        residual = max(
            abs(grad[i] + sum(amounts[r] * solids[p][1][i] for r, p in enumerate(rows)))
            / scale[i]
            for i in range(nc)
        )
        if residual < 1e-10 and max(map(abs, step)) < 1e-10:
            worst = min(range(len(rows)), key=lambda r: amounts[r], default=None)
            if worst is None or amounts[worst] >= 0:
                return x, dict(zip(rows, amounts))
            active.discard(rows[worst])
            continue
        longest = max(map(abs, step))
        alpha = min(1.0, 4.0 / longest) if longest else 1.0
        blocking = None
        for p in range(len(solids)):
            if p in active:
                continue
            rate = sum(m * d for m, d in zip(solids[p][1], step))
            if rate > 0:
                limit = -slack(p, x) / rate
                if limit < alpha:
                    alpha, blocking = max(limit, 0.0), p
        slope = sum(g * d for g, d in zip(grad, step))
        taken = alpha
        while True:
            trial = [xi + taken * d for xi, d in zip(x, step)]
            trial_conc, trial_value = state(trial)
            # Near the solution f is flat to rounding, so the Newton step is taken as is.
            if trial_value <= value + 1e-4 * taken * slope or longest < 1e-6 or taken < 1e-14:
                break
            taken *= 0.5
        x, conc, value = trial, trial_conc, trial_value
        if blocking is not None and taken == alpha:
            active.add(blocking)
    raise ArithmeticError("no convergence")


def solve(totals, charges, species, solids, davies, hydrogen_start=-7.0, activities=False):
    nc = len(totals)
    unit = [[float(i == j) for j in range(nc)] for i in range(nc)]
    stoich = unit + [nu for _, nu in species]
    log_k = [0.0] * nc + [k for k, _ in species]
    z = [sum(n * c for n, c in zip(nu, charges)) for nu in stoich]
    x = [hydrogen_start * LN10] + [log(t) for t in totals[1:]]
    # Start inside every saturation limit by lowering all non-hydrogen components together.
    shift = 0.0
    for k, mu in solids:
        excess = k * LN10 + sum(m * xi for m, xi in zip(mu, x))
        weight = sum(mu[1:])
        if excess > -1.0:
            shift = max(shift, (excess + 1.0) / weight)
    x = [x[0]] + [xi - shift for xi in x[1:]]
    active = set()
    gamma = [0.0] * len(stoich)  # log10 of the activity coefficients
    ionic = 0.0
    for _ in range(200):
        effective = [
            (
                (log_k[j] - gamma[j] + sum(n * gamma[i] for i, n in enumerate(nu))) * LN10,
                nu,
            )
            for j, nu in enumerate(stoich)
        ]
        limits = [
            ((k + sum(m * gamma[i] for i, m in enumerate(mu))) * LN10, mu)
            for k, mu in solids
        ]
        # A change of the coefficients can leave the previous point outside a limit.
        shift = 0.0
        for k, mu in limits:
            excess = k + sum(m * xi for m, xi in zip(mu, x))
            if excess > 0:
                shift = max(shift, (excess + 1e-9) / sum(mu[1:]))
        x = [x[0]] + [xi - shift for xi in x[1:]]
        active = set()
        x, amounts = minimise(totals, effective, limits, x, active)
        if not davies:
            break
        conc = [exp(k + sum(n * xi for n, xi in zip(nu, x))) for k, nu in effective]
        updated = 0.5 * sum(c * q * q for c, q in zip(conc, z))
        root = sqrt(updated)
        gamma = [-DAVIES_A * q * q * (root / (1 + root) - 0.3 * updated) for q in z]
        if abs(updated - ionic) <= 1e-14 * updated:
            break
        ionic = updated
    else:
        raise ArithmeticError("ionic strength did not converge")
    logs = [xi / LN10 for xi in x]
    found = [amounts.get(p, 0.0) for p in range(len(solids))]
    if activities:
        return logs, found, [v + g for v, g in zip(logs, gamma)]
    return logs, found


def read_cases(text):
    tokens = text.split()
    position = 0

    def take(count, kind=float):
        nonlocal position
        out = [kind(t) for t in tokens[position : position + count]]
        position += count
        return out

    cases = []
    for _ in range(take(1, int)[0]):
        nc, ns, np_, model = take(4, int)
        totals = take(nc)
        charges = take(nc, int)
        species = []
        for _ in range(ns):
            k = take(1)[0]
            species.append((k, take(nc, int)))
        solids = []
        for _ in range(np_):
            k = take(1)[0]
            solids.append((k, take(nc, int)))
        cases.append((totals, charges, species, solids, model == 1))
    return cases


def render(logs, amounts, extra=0):
    return " ".join(
        [f"{v:.{5 + extra}f}" for v in logs]
        + [f"{v:.{5 + extra}e}" if v > 0 else "0" for v in amounts]
    )


def main():
    extra = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    start = float(sys.argv[2]) if len(sys.argv) > 2 else -7.0
    out = [
        render(*solve(*case, hydrogen_start=start), extra)
        for case in read_cases(sys.stdin.read())
    ]
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
