"""Normalize data/*.csv (cached in build/norm) and rank regions by total quantity."""

import csv
import glob
import json
import os

DATA = "data"
BUILD = os.path.join("build", "norm")


def normalize(src: str) -> list[dict]:
    dst = os.path.join(BUILD, os.path.basename(src) + ".json")
    stamp = int(os.path.getmtime(src))
    if os.path.exists(dst):
        with open(dst) as f:
            cached = json.load(f)
        if cached["stamp"] == stamp:
            return cached["rows"]
    rows = []
    with open(src, newline="") as f:
        for row in csv.DictReader(f):
            rows.append({"region": row["region"].strip().lower(), "qty": int(row["qty"])})
    os.makedirs(BUILD, exist_ok=True)
    with open(dst, "w") as f:
        json.dump({"stamp": stamp, "rows": rows}, f)
    return rows


def totals() -> dict[str, int]:
    out: dict[str, int] = {}
    for src in sorted(glob.glob(os.path.join(DATA, "*.csv"))):
        for row in normalize(src):
            out[row["region"]] = out.get(row["region"], 0) + row["qty"]
    return out


def ranking(sums: dict[str, int]) -> list[tuple[int, str, int]]:
    regions = {region for region in sums}
    ordered = sorted(regions, key=lambda region: -sums[region])
    return [(i, region, sums[region]) for i, region in enumerate(ordered, 1)]


def main() -> None:
    for rank, region, total in ranking(totals()):
        print(f"{rank}\t{region}\t{total}")


if __name__ == "__main__":
    main()
