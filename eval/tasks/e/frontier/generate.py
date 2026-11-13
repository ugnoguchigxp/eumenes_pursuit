"""Generate tiered cases for the frontier tasks and vet them against the references.

    python3 generate.py <bracelets|ising-ring|equilibrium> <seed> <output directory> [--optimizer]

Without --optimizer it writes the hidden checks of the Solver task: two files per
tier (t1a ... t5b) and `<output>/../<id>.json` is left to the caller. With
--optimizer it writes the development and held-out inputs of the Optimizer task.
Cases whose printed answer sits near a rounding boundary, or whose answer changes
with the working precision or the starting point, are discarded.
"""

import importlib.util
import os
import random
import sys
from decimal import Decimal
from math import gcd, log10

HERE = os.path.dirname(os.path.abspath(__file__))


def load(task):
    spec = importlib.util.spec_from_file_location(
        "reference_" + task.replace("-", "_"), os.path.join(HERE, task, "reference.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------- bracelets


def bracelets(rng):
    ref = load("bracelets")

    def matrix(k, symmetric):
        while True:
            a = [[rng.randint(0, 1) for _ in range(k)] for _ in range(k)]
            if symmetric:
                a = [[a[min(i, j)][max(i, j)] for j in range(k)] for i in range(k)]
            same = all(a[i][j] == a[j][i] for i in range(k) for j in range(k))
            ones = sum(map(sum, a))
            if same == symmetric and k < ones < k * k:
                return a

    def prime_near(x):
        while not ref.is_prime(x):
            x += 1
        return x

    def divisors(n):
        count = 1
        for _, e in ref.factor(n):
            count *= e + 1
        return count

    def huge(limit):
        while True:
            kind = rng.randrange(6)
            if kind == 0:
                n = prime_near(rng.randrange(10**8, 10**9)) * prime_near(
                    rng.randrange(10**8, 10**9)
                )
            elif kind == 1:
                n = prime_near(rng.randrange(10**17, 10**18))
            elif kind == 2:
                n = 2 ** rng.randrange(40, 60)
            elif kind == 3:
                n = 1
                while n < 10**15:
                    n *= rng.choice([2, 2, 3, 3, 5, 7, 11, 13])
            elif kind == 4:
                n = rng.randrange(10**17, 10**18)
            else:
                n = prime_near(rng.randrange(10**11, 10**12)) * rng.randrange(
                    10**4, 10**6
                )
            if 3 <= n <= 10**18 and divisors(n) <= limit:
                return n

    def line(n, m, a):
        return f"{n} {m} {len(a)} " + " ".join("".join(map(str, row)) for row in a)

    def tier(t, count, limit=64):
        out = []
        for i in range(count):
            if t == 1:
                out.append(
                    line(rng.randrange(3, 12), 10**9 + 7, matrix(rng.choice([2, 3]), i % 2 == 0))
                )
            elif t == 2:
                out.append(line(rng.randrange(20, 2001), 998244353, matrix(rng.randrange(2, 5), True)))
            elif t == 3:
                out.append(line(rng.randrange(20, 2001), 998244353, matrix(rng.randrange(3, 5), False)))
            elif t == 4:
                n = huge(limit)
                while gcd(2 * n, 10**9 + 7) != 1:
                    n = huge(limit)
                out.append(line(n, 10**9 + 7, matrix(rng.randrange(2, 5), i % 3 == 0)))
            elif t == 6:  # a circulant matrix far too large to store
                k = rng.randrange(200, 1201)
                offsets = set(rng.sample(range(1, k), rng.randrange(2, 5)))
                if i % 2:
                    offsets.add(0)
                if i % 3 == 0:
                    offsets.add(k - min(offsets - {0}))
                n = huge(12)
                m = rng.choice([10**9 + 7, 10**12, rng.randrange(10**11, 10**12), 2**40])
                out.append(f"{n} {m} {k} @ " + " ".join(map(str, sorted(offsets))))
            else:
                kind = i % 4
                if kind == 0:  # the modulus divides n
                    m = rng.choice([10**9 + 7, 998244353, 10**6 + 3])
                    n = m * rng.randrange(10**3, 10**8)
                    while divisors(n) > limit:
                        n = m * rng.randrange(10**3, 10**8)
                elif kind == 1:  # a power of two against an even n
                    m = 2 ** rng.randrange(20, 40)
                    n = 2 ** rng.randrange(10, 30) * prime_near(rng.randrange(10**6, 10**8))
                elif kind == 2:  # a composite modulus sharing factors with n
                    m = rng.randrange(10**11, 10**12)
                    n = huge(limit)
                    n = n // gcd(n, 10**6) * rng.choice([6, 10, 12, 30])
                    while not 3 <= n <= 10**18 or divisors(n) > limit or gcd(2 * n, m) == 1:
                        m += 1
                        n = huge(limit) // 2 * 2
                else:
                    m = 10**12
                    n = 10 ** rng.randrange(12, 18) * rng.choice([1, 3, 7])
                    while divisors(n) > limit:
                        n //= 10
                out.append(line(n, m, matrix(rng.randrange(2, 5), False)))
        return out

    def expected(lines):
        out = []
        for row in lines:
            out.append(str(ref.answer(row)))
        return lines, out

    def timing(kind, count):
        out = []
        for _ in range(count):
            k = {"mixed": rng.choice([2, 3]), "wide": 4, "long": 2}[kind]
            n = rng.randrange(900, 1500) if kind != "long" else rng.randrange(1600, 2001)
            out.append(line(n, 998244353, matrix(k, rng.random() < 0.4)))
        return out

    return tier, expected, timing, lambda: tier(4, 8, 160) + tier(5, 8, 160)


# --------------------------------------------------------------- ising ring


def ising(rng):
    ref = load("ising-ring")

    def coupling(low=0.3, high=2.0, signed=True):
        value = round(rng.uniform(low, high), 2)
        return f"{-value if signed and rng.random() < 0.35 else value:.2f}"

    def tier(t, count):
        out = []
        for i in range(count):
            if t == 1:
                kind = ["E0", "GAP", "F"][i % 3]
                row = f"{kind} {rng.randrange(3, 11)} {coupling()} {coupling()}"
                out.append(row + (f" {rng.choice(['0.5', '1', '2', '5'])}" if kind == "F" else ""))
            elif t == 2:
                out.append(f"E0 {rng.randrange(50, 401)} {coupling(signed=False)} {coupling(signed=False)}")
            elif t == 3:
                if i % 3 == 2:  # frustrated ring
                    out.append(f"E0 {rng.randrange(11, 200) | 1} -{coupling(0.5, 2, False)} {coupling(0.2, 1.5, False)}")
                else:
                    J = rng.uniform(0.6, 2)
                    h = J * rng.uniform(0.2, 1.3)
                    out.append(f"F {rng.randrange(12, 61)} {J:.2f} {h:.2f} {rng.choice(['1', '2', '4', '8', '20'])}")
            elif t == 4:
                kind = i % 4
                L = rng.randrange(12, 401)
                if kind == 0:  # disordered
                    J = rng.uniform(0.3, 1.2)
                    out.append(f"GAP {L} {J:.2f} {J * rng.uniform(1.15, 2.5):.2f}")
                elif kind == 1:  # critical
                    J = coupling(0.5, 1.5, False)
                    out.append(f"GAP {L} {J} {J}")
                elif kind == 2:  # frustrated
                    out.append(f"GAP {(L - 1) | 1} -{coupling(0.5, 2, False)} {coupling(0.2, 1.5, False)}")
                else:  # ordered, short ring: the splitting is still visible in doubles
                    J = rng.uniform(0.8, 2)
                    out.append(f"GAP {rng.randrange(6, 15)} {J:.2f} {J * rng.uniform(0.55, 0.9):.2f}")
            elif t == 6:  # rings far too long to visit every momentum
                J = rng.uniform(0.6, 2)
                if i % 3 == 0:
                    L = int(10 ** rng.uniform(4, 9))
                    out.append(f"GAP {L} {J:.2f} {float(f'{J:.2f}') * rng.uniform(0.2, 0.995):.4f}")
                elif i % 3 == 1:
                    out.append(f"GAP {int(10 ** rng.uniform(3, 15))} {J:.2f} {J:.2f}")
                else:
                    L = int(10 ** rng.uniform(3, 4.3))
                    out.append(f"GAP {L} {J:.2f} {float(f'{J:.2f}') * 2.718281828 ** (rng.uniform(8, 25) / L):.6f}")
            else:
                J = rng.uniform(0.6, 2)
                sign = "-" if i % 4 == 3 else ""
                L = rng.randrange(24, 401)
                L += (L % 2) if sign else 0  # an even ring: the sign of J can be gauged away
                out.append(f"GAP {L} {sign}{J:.2f} {J * rng.uniform(0.3, 0.95):.2f}")
        return out

    def expected(lines):
        kept, out = [], []
        for row in lines:
            parts = row.split()
            ref.set_precision(130)
            value = ref.answer(parts)
            ref.set_precision(260)
            precise = ref.answer(parts)
            ref.set_precision(130)
            shown, audit = ref.scientific(value, 8), ref.scientific(precise, 14)
            if ref.scientific(value, 14) != audit:
                continue
            tail = int(audit.split("e")[0].replace("-", "").replace(".", "")[8:]) / 10**6
            if abs(tail - 0.5) < 0.002:
                continue
            if parts[0] == "GAP" and int(parts[1]) <= 400 and not Decimal("1e-80") < value:
                continue
            kept.append(row)
            out.append(shown)
        return kept, out

    def timing(kind, count):
        out = []
        for _ in range({"mixed": count, "thermal": count // 2, "ordered": 2 * count}[kind]):
            J = rng.uniform(0.6, 2)
            if kind == "mixed":
                out += tier(rng.choice([2, 3, 4]), 1)
            elif kind == "thermal":
                L = rng.randrange(40, 121)
                out.append(f"F {L} {J:.2f} {J * rng.uniform(0.3, 1.5):.2f} {rng.choice(['1', '3', '9'])}")
            else:
                out.append(f"GAP {rng.randrange(200, 401)} {J:.2f} {J * rng.uniform(0.8, 0.97):.2f}")
        return out

    def large():
        return tier(2, 8) + tier(3, 10) + tier(4, 10) + tier(5, 10)

    return tier, expected, timing, large


# --------------------------------------------------------------- equilibrium


def equilibrium(rng):
    ref = load("equilibrium")

    def system(nm, nl, np_, model, trace, wild=1.0):
        nc = 1 + nm + nl
        zm = [rng.choice([1, 2, 2, 3]) for _ in range(nm)]
        zl = [rng.choice([1, 1, 2, 3]) for _ in range(nl)]
        charges = [1] + zm + [-z for z in zl]
        vec = lambda **parts: [parts.get(f"c{i}", 0) for i in range(nc)]
        species = [(-14.0, vec(c0=-1))]
        for l, z in enumerate(zl):
            pk, total = rng.uniform(5, 13) * wild, 0.0
            for i in range(1, rng.randrange(1, z + 2)):
                total += pk
                species.append((total, vec(c0=i, **{f"c{1 + nm + l}": 1})))
                pk -= rng.uniform(2, 5)
                if pk < 0.5:
                    break
        for m, z in enumerate(zm):
            pk, total = rng.uniform(6, 12) * wild, 0.0
            for i in range(1, rng.randrange(1, z + 2)):
                total -= pk
                species.append((total, vec(c0=-i, **{f"c{1 + m}": 1})))
                pk += rng.uniform(0.5, 2)
            for l in range(nl):
                if rng.random() < 0.7:
                    step, total = rng.uniform(1.5, 9) * wild, 0.0
                    for b in range(1, rng.randrange(1, 4)):
                        total += step
                        species.append((total, vec(**{f"c{1 + m}": 1, f"c{1 + nm + l}": b})))
                        step -= rng.uniform(0.5, 2.5)
                        if step < 0.3:
                            break
        solids = []
        while len(solids) < np_:
            m = rng.randrange(nm)
            if rng.random() < 0.35:
                z = zm[m]
                solids.append((-rng.uniform(3, 8) * z * wild, vec(c0=-z, **{f"c{1 + m}": 1})))
            else:
                l = rng.randrange(nl)
                common = zm[m] * zl[l] // gcd(zm[m], zl[l])
                a, b = common // zm[m], common // zl[l]
                parts = {f"c{1 + m}": a, f"c{1 + nm + l}": b}
                k = rng.uniform(3, 9) * (a + b) / 2 * wild
                solids.append((k, vec(**parts)))
                if len(solids) < np_ and rng.random() < 0.3:  # a less stable polymorph
                    solids.append((k - rng.uniform(0.3, 1.5), vec(**parts)))
        low = (-18 if wild > 1 else -12) if trace else -6
        totals = [0.0] + [10 ** rng.uniform(low, -1) for _ in range(nm + nl)]
        if trace:
            for i in range(1, nc):
                if rng.random() < 0.5:
                    totals[i] = 10 ** rng.uniform(-4, -1)
        totals[0] = rng.uniform(-0.8, 1.2) * sum(
            zl[l] * totals[1 + nm + l] for l in range(nl)
        ) - rng.uniform(0, 1.5) * sum(zm[m] * totals[1 + m] for m in range(nm))
        totals = [float(f"{t:.5e}") for t in totals]
        species = [(round(k, 2), nu) for k, nu in species]
        solids = [(round(k, 2), mu) for k, mu in solids[:np_]]
        return totals, charges, species, solids, model == 1

    def text(case):
        totals, charges, species, solids, davies = case
        rows = [
            f"{len(totals)} {len(species)} {len(solids)} {int(davies)}",
            " ".join(f"{t:.5e}" for t in totals),
            " ".join(map(str, charges)),
        ]
        rows += [f"{k:.2f} " + " ".join(map(str, nu)) for k, nu in species + solids]
        return "\n".join(rows)

    def check(case, logs, amounts):
        """Independent of the solver: mass balance, mass action, saturation, complementarity."""
        totals, charges, species, solids, davies = case
        nc = len(totals)
        stoich = [[int(i == j) for j in range(nc)] for i in range(nc)] + [nu for _, nu in species]
        log_k = [0.0] * nc + [k for k, _ in species]
        z = [sum(n * c for n, c in zip(nu, charges)) for nu in stoich]
        gamma = [0.0] * len(stoich)
        conc = None
        for _ in range(500 if davies else 1):
            conc = [
                10 ** (log_k[j] - gamma[j] + sum(n * (logs[i] + gamma[i]) for i, n in enumerate(nu)))
                for j, nu in enumerate(stoich)
            ]
            if not davies:
                break
            ionic = 0.5 * sum(c * q * q for c, q in zip(conc, z))
            root = ionic**0.5
            updated = [-ref.DAVIES_A * q * q * (root / (1 + root) - 0.3 * ionic) for q in z]
            if max(abs(a - b) for a, b in zip(updated, gamma)) < 1e-15:
                break
            gamma = updated
        else:
            return None
        ionic = 0.5 * sum(c * q * q for c, q in zip(conc, z))
        if davies and ionic > 0.5:
            return None
        for i in range(nc):
            terms = [c * nu[i] for c, nu in zip(conc, stoich)] + [
                n * mu[i] for n, (_, mu) in zip(amounts, solids)
            ]
            if abs(sum(terms) - totals[i]) > 1e-9 * (sum(map(abs, terms)) + abs(totals[i])):
                return None
        margin = 9.0
        for n, (k, mu) in zip(amounts, solids):
            index = k + sum(m * (logs[i] + gamma[i]) for i, m in enumerate(mu))
            if n > 0:
                if abs(index) > 1e-9:
                    return None
                scale = min(totals[i] / m for i, m in enumerate(mu) if i and m)
                if n < 1e-4 * scale:
                    return None
            else:
                if index > -1e-3:
                    return None
                margin = min(margin, -index)
        return margin

    def expected(cases):
        kept, out = [], []
        for case in cases:
            try:
                logs, amounts = ref.solve(*case)
                again, again_amounts = ref.solve(*case, hydrogen_start=-3.0)
                if ref.render(logs, amounts, 4) != ref.render(again, again_amounts, 4):
                    continue
                if check(case, logs, amounts) is None:
                    continue
            except (ArithmeticError, ValueError):
                continue
            if min(logs) < -30 or not -1 < -logs[0] < 15:
                continue
            fine = ref.render(logs, amounts, 4).split()
            near = False
            for token in fine:
                if token == "0":
                    continue
                digits = token.split("e")[0].replace("-", "").replace(".", "")
                near |= abs(int(digits[-4:]) / 10**4 - 0.5) < 0.002
            if near:
                continue
            kept.append(case)
            out.append(ref.render(logs, amounts))
        return kept, out

    def tier(t, count):
        out = []
        while len(out) < count:
            if t == 1:
                case = system(0, rng.randrange(1, 3), 0, 0, False)
            elif t == 2:
                case = system(rng.randrange(2, 4), rng.randrange(2, 4), 0, 0, False)
            elif t == 3:
                case = system(rng.randrange(2, 4), rng.randrange(1, 4), rng.randrange(2, 7), 0, False)
            elif t == 4:
                case = system(rng.randrange(1, 4), rng.randrange(1, 4), rng.randrange(0, 7), 1, False)
            elif t == 5:
                case = system(
                    rng.randrange(3, 6), rng.randrange(3, 5), rng.randrange(10, 26), len(out) % 2, True
                )
            else:
                case = system(
                    rng.randrange(6, 9), rng.randrange(5, 8), rng.randrange(30, 61), len(out) % 2, True, 1.6
                )
            kept, answers = expected([case])
            if not kept:
                continue
            present = sum(token != "0" for token in answers[0].split()[len(case[0]) :])
            if t in (3, 5, 6) and len(out) % 4 != 3 and present < (3 if t == 6 else 1):
                continue
            out.append(case)
        return out

    def timing(kind, count):
        out = []
        while len(out) < count:
            if kind == "mixed":
                case = system(2, 2, rng.randrange(4, 8), len(out) % 2, False)
            elif kind == "ideal":
                case = system(3, 3, rng.randrange(5, 8), 0, False)
            else:
                case = system(2, 3, rng.randrange(4, 8), 1, False)
            if expected([case])[0]:
                out.append(case)
        return out

    def large():
        return tier(5, 24)

    def render(cases):
        kept, out = expected(cases)
        assert len(kept) == len(cases)
        return [text(case) for case in kept], out

    return tier, render, timing, large


TASKS = {"bracelets": bracelets, "ising-ring": ising, "equilibrium": equilibrium}
PER_FILE = {"bracelets": 12, "ising-ring": 12, "equilibrium": 8}
LAST_TIER = {"bracelets": 6, "ising-ring": 12, "equilibrium": 16}  # questions per tier-6 file


def write(directory, name, lines, answers):
    with open(os.path.join(directory, name + ".in"), "w") as handle:
        handle.write(f"{len(lines)}\n" + "\n".join(lines) + "\n")
    with open(os.path.join(directory, name + ".out"), "w") as handle:
        handle.write("\n".join(answers) + "\n")


def main():
    task, seed, directory = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    optimizer = "--optimizer" in sys.argv[4:]
    rng = random.Random(f"{task}:{seed}:{optimizer}")
    tier, expected, timing, large = TASKS[task](rng)
    os.makedirs(directory, exist_ok=True)
    count = PER_FILE[task]
    if not optimizer:
        for t in range(1, 7):
            for part in "ab":
                write(directory, f"t{t}{part}", *expected(tier(t, LAST_TIER[task] if t == 6 else count)))
        return
    for prefix in ("check", "heldout-check"):
        for t in range(1, 6):
            write(directory, f"{prefix}-t{t}", *expected(tier(t, max(4, count // 2))))
    for kind in ("mixed", "wide", "long") if task == "bracelets" else (
        ("mixed", "thermal", "ordered") if task == "ising-ring" else ("mixed", "ideal", "davies")
    ):
        write(directory, f"timing-{kind}", *expected(timing(kind, count)))
    write(directory, "large", *expected(large()))
    for part in "abc":
        write(directory, f"heldout-large-{part}", *expected(large()))


if __name__ == "__main__":
    main()
