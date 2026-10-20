"""Exact checks for proof tasks. Input (stdin JSON): {"items": [{"lhs","op","rhs"}], "digits": 60}.
Expressions are pre-validated by eval/tools/math.ts (allow-listed names, no attributes)."""
import json
import sys

import sympy
from sympy.parsing.sympy_parser import (
    convert_xor,
    parse_expr,
    rationalize,
    standard_transformations,
)

NAMES = {
    "pi": sympy.pi, "E": sympy.E, "sqrt": sympy.sqrt, "log": sympy.log, "ln": sympy.log,
    "exp": sympy.exp, "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan,
    "atan": sympy.atan, "asin": sympy.asin, "acos": sympy.acos, "zeta": sympy.zeta,
    "Catalan": sympy.Catalan, "EulerGamma": sympy.EulerGamma, "factorial": sympy.factorial,
    "binomial": sympy.binomial, "gamma": sympy.gamma, "polylog": sympy.polylog,
    "Rational": sympy.Rational, "Abs": sympy.Abs,
}
# Decimals are exact rationals: 6.1 means 61/10, never a binary float.
T = standard_transformations + (convert_xor, rationalize)


def parse(text):
    return parse_expr(text, local_dict=dict(NAMES), global_dict={"__builtins__": {}, **{
        k: getattr(sympy, k) for k in ("Integer", "Float", "Symbol", "Rational")}},
        transformations=T, evaluate=True)


def main():
    req = json.load(sys.stdin)
    digits = int(req.get("digits", 60))
    out = []
    for item in req.get("items", []):
        try:
            lhs, rhs = parse(item["lhs"]), parse(item["rhs"])
            if lhs.free_symbols or rhs.free_symbols:
                raise ValueError("free symbols")
            diff = sympy.N(lhs - rhs, digits)
            if not diff.is_real:
                raise ValueError("not real")
            eps = sympy.Float(10) ** (-(digits - 10))
            op = item["op"]
            ok = {
                "<": diff < -eps, ">": diff > eps, "<=": diff < eps, ">=": diff > -eps,
                "=": abs(diff) < eps,
            }[op]
            out.append({"ok": bool(ok), "value": str(sympy.N(lhs, 20)), "rhs": str(sympy.N(rhs, 20))})
        except Exception as error:  # noqa: BLE001 - every failure is reported, never raised
            out.append({"ok": False, "error": type(error).__name__})
    if "evaluate" in req:
        try:
            out.append({"value": str(sympy.N(parse(req["evaluate"]), int(req.get("evalDigits", 30))))})
        except Exception as error:  # noqa: BLE001
            out.append({"error": type(error).__name__})
    json.dump(out, sys.stdout)


main()
