"""Exact checks for proof tasks. Input (stdin JSON): {"items": [{"lhs","op","rhs"}], "digits": 60}.
Expressions are pre-validated by eval/tools/math.ts (allow-listed names, no attributes)."""
import json
import sys

import sympy
from mpmath.libmp import prec_to_dps
from sympy.parsing.sympy_parser import (
    convert_xor,
    parse_expr,
    rationalize,
    standard_transformations,
)

# zbar(5, 1) = sum_{n>m>=1} (-1)^(n+m) / (n^5 m), the alternating double zeta value
# zeta(-5,-1) (Borwein-Bradley-Broadhurst sign convention). Weight-6 alternating Euler
# sums need it beside polylog(k, 1/2). Computed as -int_0^1 (Li5(-1) + Li5(x)/x)/(1+x) dx
# at 360 digits, agreeing with a 330-digit run and with the direct double series.
ZBAR51 = (
    "-0.0299016355811494259428679217491003137657903411185851045672496124587"
    "1848378316894432413441389375958137824862860839971252334143998024879221"
    "9812622847928775994994708020509245459013825078964792572689007405213817"
    "6487750929937924666384597213877496739361033791044661727591090823563573"
    "037865586538806791469471949068742200889072"
)


class zbar(sympy.Function):
    """Alternating double zeta value; only zbar(5, 1) has a value (see ZBAR51)."""

    nargs = 2

    def _eval_evalf(self, prec):
        if tuple(self.args) != (sympy.Integer(5), sympy.Integer(1)):
            return None
        dps = prec_to_dps(prec)
        if dps > 300:
            raise ValueError("zbar precision")
        return sympy.Float(ZBAR51, dps + 5)


NAMES = {
    "pi": sympy.pi, "E": sympy.E, "sqrt": sympy.sqrt, "log": sympy.log, "ln": sympy.log,
    "exp": sympy.exp, "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan,
    "atan": sympy.atan, "asin": sympy.asin, "acos": sympy.acos, "zeta": sympy.zeta,
    "Catalan": sympy.Catalan, "EulerGamma": sympy.EulerGamma, "factorial": sympy.factorial,
    "binomial": sympy.binomial, "gamma": sympy.gamma, "polylog": sympy.polylog,
    "Rational": sympy.Rational, "Abs": sympy.Abs, "zbar": zbar,
}
# Decimals are exact rationals: 6.1 means 61/10, never a binary float.
T = standard_transformations + (convert_xor, rationalize)


def parse(text):
    return parse_expr(text, local_dict=dict(NAMES), global_dict={"__builtins__": {}, **{
        k: getattr(sympy, k) for k in ("Integer", "Float", "Symbol", "Rational")}},
        transformations=T, evaluate=True)


IV_NAMES = {"sqrt", "pi", "log", "exp", "sin", "cos", "tan", "E"}


def interval(expr):
    """Rigorous enclosure with mpmath interval arithmetic, or None when unsupported."""
    from mpmath import iv

    funcs = {f.func.__name__ for f in expr.atoms(sympy.Function)}
    consts = {str(c) for c in expr.atoms(sympy.NumberSymbol)}
    if not funcs <= IV_NAMES or not consts <= {"pi", "E"}:
        return None
    iv.dps = 80
    ns = {k: getattr(iv, k) for k in ("mpf", "sqrt", "pi", "log", "exp", "sin", "cos", "tan")}
    ns["E"] = iv.e
    try:
        value = sympy.lambdify([], expr, modules=[ns])()
        return value if hasattr(value, "a") else None
    except Exception:  # noqa: BLE001
        return None


def decide(lhs, rhs, op, digits):
    """(ok, assurance): exact for rationals, symbolic zero or a separating interval; numeric otherwise."""
    diff = lhs - rhs
    if diff.is_Rational:
        sign = int(bool(diff > 0)) - int(bool(diff < 0))
        return {"<": sign < 0, ">": sign > 0, "<=": sign <= 0, ">=": sign >= 0, "=": sign == 0}[op], "exact"
    if op == "=":
        if sympy.simplify(diff) == 0:
            return True, "exact"
    else:
        enclosure = interval(diff)
        if enclosure is not None and (enclosure.a > 0 or enclosure.b < 0):
            positive = enclosure.a > 0
            return {"<": not positive, ">": positive, "<=": not positive, ">=": positive}[op], "exact"
    value = sympy.N(diff, digits)
    if not value.is_real:
        raise ValueError("not real")
    eps = sympy.Float(10) ** (-(digits - 10))
    ok = {"<": value < -eps, ">": value > eps, "<=": value < eps, ">=": value > -eps, "=": abs(value) < eps}[op]
    return bool(ok), "numeric"


def main():
    req = json.load(sys.stdin)
    digits = int(req.get("digits", 60))
    out = []
    for item in req.get("items", []):
        try:
            lhs, rhs = parse(item["lhs"]), parse(item["rhs"])
            if lhs.free_symbols or rhs.free_symbols:
                raise ValueError("free symbols")
            ok, assurance = decide(lhs, rhs, item["op"], digits)
            out.append({"ok": bool(ok), "assurance": assurance, "value": str(sympy.N(lhs, 20)), "rhs": str(sympy.N(rhs, 20))})
        except Exception as error:  # noqa: BLE001 - every failure is reported, never raised
            out.append({"ok": False, "error": type(error).__name__})
    if "evaluate" in req:
        try:
            out.append({"value": str(sympy.N(parse(req["evaluate"]), int(req.get("evalDigits", 30))))})
        except Exception as error:  # noqa: BLE001
            out.append({"error": type(error).__name__})
    json.dump(out, sys.stdout)


main()
