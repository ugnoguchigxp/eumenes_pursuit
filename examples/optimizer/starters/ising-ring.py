import sys
from decimal import Decimal, getcontext

getcontext().prec = 60


def pi():
    # Machin's formula, summed term by term.
    def arctan_inverse(n):
        x = Decimal(1) / n
        total = term = x
        k = 1
        while abs(term) > Decimal(10) ** -65:
            term = -term * x * x
            k += 2
            total += term / k
        return total

    return 16 * arctan_inverse(5) - 4 * arctan_inverse(239)


def cosine(x):
    total = term = Decimal(1)
    k = 0
    while abs(term) > Decimal(10) ** -65:
        k += 2
        term = -term * x * x / (k * (k - 1))
        total += term
    return total


def band(L, J, h):
    # Free-fermion band after the Jordan-Wigner transformation.
    energies = []
    for m in range(L):
        k = (2 * m + 1) * pi() / L
        energies.append(2 * (J * J + h * h - 2 * J * h * cosine(k)).sqrt())
    return energies


def answer(parts):
    kind, L, J, h = parts[0], int(parts[1]), Decimal(parts[2]), Decimal(parts[3])
    energies = band(L, J, h)
    if kind == "E0":
        return -sum(energies) / 2
    if kind == "GAP":
        return min(energies)
    beta = Decimal(parts[4])
    return -sum((2 * ((beta * e / 2).exp() + (-beta * e / 2).exp()) / 2).ln() for e in energies) / beta


def main():
    count = int(sys.stdin.readline())
    for _ in range(count):
        print("%.7e" % float(answer(sys.stdin.readline().split())))


if __name__ == "__main__":
    main()
