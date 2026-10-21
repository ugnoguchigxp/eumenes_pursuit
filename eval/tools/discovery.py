"""Checker for discovery tasks. Input (stdin JSON): {"kind", "submission", "spec", "secret"}.
Output: {"ok": bool, "reason": str}. The reason never contains secret values.

kinds:
  integer       submission.expression: a closed expression with an integer value (== secret.value)
  formula       submission.expression in n; equal to secret.values[n] for every listed n
  series        submission.expression in x: a rational function whose Taylor coefficients equal secret.coefficients
  construction  submission.grid (rows of '#'/'.') and submission.count; spec.rule/rows/cols; count == secret.optimum
Expressions are pre-validated by eval/tools/discovery.ts (allow-listed names, safe characters)."""
import json
import sys

import sympy
from sympy.parsing.sympy_parser import (
    convert_xor,
    parse_expr,
    rationalize,
    standard_transformations,
)

N = sympy.Symbol("n", integer=True, positive=True)
X = sympy.Symbol("x")
FUNCS = {
    "floor": sympy.floor,
    "ceiling": sympy.ceiling,
    "Mod": sympy.Mod,
    "binomial": sympy.binomial,
    "factorial": sympy.factorial,
    "Abs": sympy.Abs,
}
NAMES = {
    "integer": {k: FUNCS[k] for k in ("binomial", "factorial")},
    "formula": {**FUNCS, "n": N},
    "series": {"x": X},
}


def parse(text, kind):
    return parse_expr(
        text,
        local_dict=dict(NAMES[kind]),
        global_dict={"__builtins__": {}, "Integer": sympy.Integer, "Rational": sympy.Rational,
                     "Float": sympy.Float, "Symbol": sympy.Symbol},
        transformations=standard_transformations + (convert_xor, rationalize),
        evaluate=True,
    )


def as_int(v):
    v = sympy.nsimplify(sympy.simplify(v)) if not v.is_Integer else v
    return int(v) if v.is_Integer else None


def check_integer(sub, secret):
    e = parse(sub["expression"], "integer")
    if e.free_symbols:
        return False, "数でない記号を含みます"
    v = as_int(e)
    if v is None:
        return False, "整数になりません"
    return (v == int(secret["value"])), ("一致" if v == int(secret["value"]) else "不一致")


def check_formula(sub, secret):
    e = parse(sub["expression"], "formula")
    if e.free_symbols - {N}:
        return False, "n 以外の記号を含みます"
    for k, want in sorted(secret["values"].items(), key=lambda kv: int(kv[0])):
        got = e.subs(N, int(k))
        got = as_int(got)
        if got is None:
            return False, "ある n で整数になりません"
        if got != int(want):
            return False, "ある n で値が一致しません"
    return True, "照合したすべての n で一致"


def check_series(sub, secret):
    e = sympy.cancel(sympy.together(parse(sub["expression"], "series")))
    if e.free_symbols - {X}:
        return False, "x 以外の記号を含みます"
    num, den = sympy.fraction(e)
    try:
        pn, pd = sympy.Poly(num, X, domain="QQ"), sympy.Poly(den, X, domain="QQ")
    except sympy.PolynomialError:
        return False, "x の有理式ではありません"
    d0 = pd.eval(0)
    if d0 == 0:
        return False, "x = 0 で正則ではありません"
    want = [int(c) for c in secret["coefficients"]]
    a = pn.all_coeffs()[::-1]
    b = pd.all_coeffs()[::-1]
    coeffs = []
    for k in range(len(want)):
        s = (a[k] if k < len(a) else 0) - sum(b[j] * coeffs[k - j] for j in range(1, min(k, len(b) - 1) + 1))
        coeffs.append(sympy.Rational(s) / d0)
    if any(c != w for c, w in zip(coeffs, want)):
        return False, "係数が一致しません"
    return True, f"最初の {len(want)} 個の係数が一致"


RULES = {
    # each marked cell: exactly one marked edge-neighbour and exactly one marked corner-neighbour
    "o1d1": lambda o, d: o == 1 and d == 1,
    # each marked cell: exactly two marked king-neighbours
    "king2": lambda o, d: o + d == 2,
}


def check_construction(sub, spec, secret):
    rows, cols, rule = int(spec["rows"]), int(spec["cols"]), RULES[spec["rule"]]
    grid = [r.strip() for r in str(sub["grid"]).strip().splitlines() if r.strip()]
    if len(grid) != rows or any(len(r) != cols for r in grid):
        return False, f"盤の大きさが {rows} 行 × {cols} 列ではありません"
    if any(ch not in "#." for r in grid for ch in r):
        return False, "使える文字は # と . だけです"
    marked = {(i, j) for i in range(rows) for j in range(cols) if grid[i][j] == "#"}
    for i, j in sorted(marked):
        o = sum((i + a, j + b) in marked for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        d = sum((i + a, j + b) in marked for a in (-1, 1) for b in (-1, 1))
        if not rule(o, d):
            return False, f"条件を満たさない印があります（{i + 1} 行 {j + 1} 列）"
    if int(sub["count"]) != len(marked):
        return False, "申告した印の数が配置の印の数と違います"
    if len(marked) != int(secret["optimum"]):
        return False, "条件は満たしますが、印の数が最大ではありません"
    return True, "条件を満たし、印の数が最大"


def main():
    req = json.load(sys.stdin)
    kind, sub, secret = req["kind"], req["submission"], req["secret"]
    try:
        if kind == "integer":
            ok, reason = check_integer(sub, secret)
        elif kind == "formula":
            ok, reason = check_formula(sub, secret)
        elif kind == "series":
            ok, reason = check_series(sub, secret)
        elif kind == "construction":
            ok, reason = check_construction(sub, req.get("spec") or {}, secret)
        else:
            ok, reason = False, "unknown kind"
    except Exception as error:  # noqa: BLE001 - any parse/eval failure is a plain fail
        ok, reason = False, f"評価できません（{type(error).__name__}）"
    json.dump({"ok": bool(ok), "reason": reason}, sys.stdout, ensure_ascii=False)


main()
