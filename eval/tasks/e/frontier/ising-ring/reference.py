"""Reference for the transverse-field Ising ring: exact finite-size spectrum and free energy.

H = -J Σ σx_i σx_{i+1} - h Σ σz_i on a ring of L sites. After the Jordan-Wigner
transformation the even-parity sector has antiperiodic fermions (k = (2m+1)π/L)
and the odd-parity sector periodic ones (k = 2mπ/L). Each mode contributes
e (n - 1/2); modes k and -k share e = 2 sqrt(J² + h² - 2Jh cos k) > 0, while the
self-conjugate modes keep a signed energy, e(0) = 2(h - J) and e(π) = 2(h + J).
A state belongs to the spin chain only when the number of occupied modes is
even (antiperiodic) or odd (periodic). All arithmetic is decimal, because the
splitting between the sectors can be far below double precision.
"""

import sys
from decimal import Decimal, getcontext

getcontext().prec = 130
getcontext().Emin = -(10**17)
getcontext().Emax = 10**17
ZERO = Decimal(0)
ONE = Decimal(1)
TWO = Decimal(2)


def arctan_inverse(n):
    x = ONE / n
    square = x * x
    term = total = x
    k = 1
    while abs(term) > Decimal(10) ** -(getcontext().prec + 5):
        term = -term * square
        k += 2
        total += term / k
    return total


PI = 16 * arctan_inverse(5) - 4 * arctan_inverse(239)


def set_precision(digits):
    global PI
    getcontext().prec = digits
    PI = 16 * arctan_inverse(5) - 4 * arctan_inverse(239)


def cosine(x):
    halvings = 0
    while abs(x) > Decimal("0.001"):
        x /= 2
        halvings += 1
    square = x * x
    term = total = ONE
    k = 0
    while abs(term) > Decimal(10) ** -(getcontext().prec + 5):
        k += 2
        term = -term * square / (k * (k - 1))
        total += term
    for _ in range(halvings):
        total = 2 * total * total - 1
    return total


def modes(L, J, h, periodic):
    """Signed mode energies of one sector, one entry per momentum."""
    out = []
    step = cosine(2 * PI / L)
    if periodic:
        out.append(2 * (h - J))
        if L % 2 == 0:
            out.append(2 * (h + J))
        previous, current = ONE, step
        count = (L - 1) // 2
    else:
        if L % 2 == 1:
            out.append(2 * (h + J))
        first = cosine(PI / L)
        # cos(-π/L) = cos(π/L) seeds the recurrence c(k + δ) = 2 cos δ c(k) - c(k - δ).
        previous, current = first, first
        count = L // 2
    for _ in range(count):
        energy = 2 * (J * J + h * h - 2 * J * h * current).sqrt()
        out += [energy, energy]
        previous, current = current, 2 * step * current - previous
    return out


def lowest_two(energies, odd):
    """The two lowest levels (with multiplicity) whose occupation has the given parity."""
    base = -sum(abs(e) for e in energies) / 2
    flips = sorted(abs(e) for e in energies)
    wrong = (sum(e < 0 for e in energies) % 2 == 1) != odd
    if wrong:
        return [base + flips[0], base + flips[1]] if len(flips) > 1 else [base + flips[0]]
    return [base, base + flips[0] + flips[1]] if len(flips) > 1 else [base]


def levels(L, J, h):
    return sorted(
        lowest_two(modes(L, J, h, False), False) + lowest_two(modes(L, J, h, True), True)
    )


def sector_log(energies, beta, sign):
    """ln of the sector's trace: (1/2) [Π 2cosh ± Π 2sinh]; None when it vanishes."""
    log_cosh = ZERO
    ratio = ONE
    for e in energies:
        x = beta * abs(e)
        q = (-x).exp()
        log_cosh += x / 2 + (1 + q).ln()
        ratio *= (1 - q) / (1 + q)
        if e < 0:
            ratio = -ratio
    weight = 1 + sign * ratio
    if weight <= 0:
        return None
    return log_cosh + weight.ln() - TWO.ln()


def free_energy(L, J, h, beta):
    logs = [
        value
        for value in (
            sector_log(modes(L, J, h, False), beta, 1),
            sector_log(modes(L, J, h, True), beta, -1),
        )
        if value is not None
    ]
    top = max(logs)
    return -(top + sum((value - top).exp() for value in logs).ln()) / beta


def fourier(n, ratio):
    """Coefficient of e^{ikn} in sqrt((1 - r e^{ik})(1 - r e^{-ik})), 0 < r < 1, n >= 1.

    With (1 - z)^{1/2} = Σ a_m z^m it equals r^n Σ_m a_m a_{m+n} r^{2m}.
    """
    half = Decimal("0.5")
    if n < 2000:
        leading = ONE
        for m in range(n):
            leading = leading * (m - half) / (m + 1)
    else:
        # a_n = -Γ(n - 1/2) / (2 √π Γ(n + 1)), by Stirling's series.
        def log_gamma(z):
            return (
                (z - half) * z.ln() - z + (2 * PI).ln() / 2
                + 1 / (12 * z) - 1 / (360 * z**3) + 1 / (1260 * z**5)
            )

        x = Decimal(n)
        leading = -(log_gamma(x - half) - log_gamma(x + 1)).exp() / (2 * PI.sqrt())
    total, term, a, m = ZERO, ONE, ONE, 0
    square = ratio * ratio
    while True:
        total += a * term
        term = term * (m + n - half) / (m + n + 1) * square
        a = a * (m - half) / (m + 1)
        m += 1
        if abs(a * term) < Decimal("1e-45") * abs(total):
            return ratio**n * leading * total


def long_ring_gap(L, J, h):
    """E_1 - E_0 for J, h > 0 without visiting the L momenta.

    The two sectors sample the same band on grids shifted by π/L, so by Poisson
    summation their vacuum energies differ by 2L Σ_{j odd} c_{jL}, where c_n are
    the Fourier coefficients of the band. At h = J the sums are elementary.
    """
    if J == h:
        c = cosine(PI / (4 * L))
        return 2 * J * (1 - c * c).sqrt() / c
    ratio = min(J, h) / max(J, h)
    total, j = ZERO, 1
    while True:
        c = fourier(j * L, ratio)
        total += c
        if abs(c) < Decimal("1e-40") * abs(total):
            break
        j += 2
    split = 4 * L * max(J, h) * total
    return -split if h < J else 2 * (h - J) - split


def answer(parts):
    kind, L, J, h = parts[0], int(parts[1]), Decimal(parts[2]), Decimal(parts[3])
    if kind == "E0":
        return levels(L, J, h)[0]
    if kind == "GAP" and L > 400:
        return long_ring_gap(L, J, h)
    if kind == "GAP":
        found = levels(L, J, h)
        return found[1] - found[0]
    if kind == "F":
        return free_energy(L, J, h, Decimal(parts[4]))
    raise ValueError(kind)


def scientific(value, digits):
    """printf-style %.{digits-1}e: the exponent has a sign and at least two digits."""
    mantissa, exponent = format(value, f".{digits - 1}e").split("e")
    if Decimal(mantissa) == 0:
        return f"{'0.' + '0' * (digits - 1)}e+00"
    return f"{mantissa}e{'-' if int(exponent) < 0 else '+'}{abs(int(exponent)):02d}"


def main():
    digits = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    rows = sys.stdin.read().split("\n")
    out = []
    for line in rows[1 : 1 + int(rows[0])]:
        out.append(scientific(answer(line.split()), digits))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
