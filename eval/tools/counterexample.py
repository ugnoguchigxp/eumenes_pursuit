"""Exact checks of submitted counterexamples (hidden-truth tasks, eval/tasks/e/verdict.ts).

Reads {"rule": {...}, "data": "..."} on stdin, writes {"ok": bool, "reason": str}. The reason
describes only the submission (shape, which condition fails), never whether the statement is
true; the host does not forward it to the executor anyway. Integers and Fractions only.
"""

import json
import re
import sys
from fractions import Fraction
from math import gcd

RATIONAL = re.compile(r"^-?\d{1,60}(/\d{1,60})?$")


def rationals(text, lo, hi):
    items = [t.strip() for t in text.replace("\n", ",").split(",") if t.strip()]
    if not lo <= len(items) <= hi:
        raise ValueError(f"個数は {lo} 以上 {hi} 以下です")
    if not all(RATIONAL.match(t) for t in items):
        raise ValueError("有理数（整数または p/q）だけを書いてください")
    out = [Fraction(t) for t in items]
    return out


def rational_matrix(text, lo, hi):
    rows = [r for r in (line.strip() for line in text.strip().splitlines()) if r]
    m = [[t for t in re.split(r"[\s,]+", r) if t] for r in rows]
    n = len(m)
    if not lo <= n <= hi or any(len(r) != n for r in m):
        raise ValueError(f"{lo} 以上 {hi} 以下の n について n 行 n 列で書いてください")
    if not all(RATIONAL.match(t) for r in m for t in r):
        raise ValueError("成分は有理数（整数または p/q）だけです")
    return [[Fraction(t) for t in r] for r in m]


def binary_matrix(text, lo, hi):
    rows = [r for r in (line.strip() for line in text.strip().splitlines()) if r]
    n = len(rows)
    if not lo <= n <= hi or any(len(r) != n for r in rows):
        raise ValueError(f"{lo} 以上 {hi} 以下の n について n 行、各行 n 文字で書いてください")
    if any(ch not in "01" for r in rows for ch in r):
        raise ValueError("使える文字は 0 と 1 だけです")
    return [[int(ch) for ch in r] for r in rows]


def rank(m, p=None):
    """Rank over Q (p is None) or over F_p."""
    m = [[(v % p) if p else Fraction(v) for v in r] for r in m]
    rows, cols, r = len(m), len(m[0]), 0
    for c in range(cols):
        piv = next((i for i in range(r, rows) if m[i][c] != 0), None)
        if piv is None:
            continue
        m[r], m[piv] = m[piv], m[r]
        inv = pow(m[r][c], p - 2, p) if p else 1 / m[r][c]
        m[r] = [(v * inv) % p if p else v * inv for v in m[r]]
        for i in range(rows):
            if i != r and m[i][c] != 0:
                f = m[i][c]
                m[i] = [((a - f * b) % p) if p else a - f * b for a, b in zip(m[i], m[r])]
        r += 1
    return r


def j_minus_i(m):
    n = len(m)
    return all(m[i][j] + m[j][i] == (0 if i == j else 1) for i in range(n) for j in range(n))


def gcd_shift(rule, data):
    t = data.strip()
    if not re.fullmatch(r"\d{1,40}", t) or int(t) < 1:
        raise ValueError("正の整数を 10 進で書いてください")
    n, a, b = int(t), int(rule["a"]), int(rule["b"])
    if gcd(n**a + b, (n + 1) ** a + b) > 1:
        return True, "条件を満たす"
    return False, "この n では二数が互いに素です"


def cyclic_ratio(rule, data):
    x = rationals(data, int(rule["minN"]), int(rule["maxN"]))
    if any(v <= 0 for v in x):
        raise ValueError("すべて正の数にしてください")
    n = len(x)
    total = Fraction(0)
    for i in range(n):
        num = sum(x[(i + o) % n] for o in rule["num"])
        den = sum(Fraction(w) * x[(i + o) % n] for o, w in rule["den"])
        total += num / den
    if total < Fraction(rule["bound"]) * n:
        return True, "条件を満たす"
    return False, "この x では不等式が成り立ちます"


def skew_rank(rule, data):
    m = rational_matrix(data, int(rule["minN"]), int(rule["maxN"]))
    if not j_minus_i(m):
        return False, "A + A^T = J − I を満たしません"
    if rank(m) <= len(m) - 2:
        return True, "条件を満たす"
    return False, "階数が n − 1 以上です"


def tournament_rank(rule, data):
    m = binary_matrix(data, int(rule["minN"]), int(rule["maxN"]))
    if not j_minus_i(m):
        return False, "トーナメント行列ではありません"
    if rank(m, int(rule["p"])) <= len(m) - 2:
        return True, "条件を満たす"
    return False, "階数が n − 1 以上です"


def gcd_form(rule, data):
    x = rationals(data, int(rule["minN"]), int(rule["maxN"]))
    n = len(x)
    q = sum(
        Fraction(gcd(i, j), i + j) * x[i - 1] * x[j - 1]
        for i in range(1, n + 1)
        for j in range(1, n + 1)
    )
    if q < 0:
        return True, "条件を満たす"
    return False, "この x では和が 0 以上です"


CHECKS = {
    "gcd-shift": gcd_shift,
    "cyclic-ratio": cyclic_ratio,
    "skew-rank": skew_rank,
    "tournament-rank": tournament_rank,
    "gcd-form": gcd_form,
}


def main():
    req = json.load(sys.stdin)
    rule = req["rule"]
    try:
        ok, reason = CHECKS[rule["name"]](rule, str(req["data"]))
    except (ValueError, KeyError, ZeroDivisionError, OverflowError) as error:
        ok, reason = False, f"形式が不正です（{error}）"
    json.dump({"ok": bool(ok), "reason": reason}, sys.stdout, ensure_ascii=False)


main()
