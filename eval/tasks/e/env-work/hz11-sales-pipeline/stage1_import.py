"""Stage 1: load every branch export (input/<branch>/*.csv) and the rates into sales.db."""
import csv
import json
import os
import sqlite3
import sys
from datetime import datetime


SCHEMA = """
CREATE TABLE sales (
    branch TEXT NOT NULL,
    receipt_no INTEGER NOT NULL,
    sold_at TEXT NOT NULL,          -- local time of the branch, 'YYYY-MM-DD HH:MM'
    category TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,  -- yen (JPY) or cents (USD)
    currency TEXT NOT NULL,
    amount_yen INTEGER,             -- sql steps 9 and 10
    biz_date TEXT,                  -- sql step 3
    biz_month TEXT,                 -- sql step 3
    fiscal_year INTEGER,            -- sql step 4
    source TEXT
);
CREATE TABLE raw_rates (month TEXT, usdjpy TEXT);
"""


# Timestamp layouts seen in the branch exports, tried in order.
FORMATS = ("%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M", "%m/%d/%Y %H:%M", "%d/%m/%Y %H:%M")


def parse_time(text: str) -> str:
    for fmt in FORMATS:
        try:
            return datetime.strptime(text.strip(), fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue
    raise ValueError(f"unknown timestamp {text!r}")


def minor_units(text: str, currency: str) -> int:
    """Amount in the currency's minor unit: yen for JPY, cents for USD."""
    text = text.strip().replace(",", "")
    if currency == "USD":
        whole, _, frac = text.partition(".")
        return int(whole) * 100 + int((frac + "00")[:2])
    return int(text)


def main(input_dir: str, db_path: str) -> None:
    with open(os.path.join(input_dir, "branches.json"), encoding="utf-8") as f:
        branches = json.load(f)
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    for branch in sorted(branches):
        conf = branches[branch]
        folder = os.path.join(input_dir, branch)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".csv"):
                continue
            # Exports are UTF-8; undecodable bytes are replaced rather than failing the whole import.
            with open(os.path.join(folder, name), encoding="utf-8", errors="replace", newline="") as f:
                for row in csv.DictReader(f):
                    db.execute(
                        "INSERT INTO sales (branch, receipt_no, sold_at, category, amount_minor, currency, source)"
                        " VALUES (?,?,?,?,?,?,?)",
                        (
                            branch,
                            int(row["receipt_no"]),
                            parse_time(row["sold_at"]),
                            row["category"].strip(),
                            minor_units(row["amount"], conf["currency"]),
                            conf["currency"],
                            f"{branch}/{name}",
                        ),
                    )
    with open(os.path.join(input_dir, "rates.csv"), encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            db.execute("INSERT INTO raw_rates VALUES (?,?)", (row["month"], row["usdjpy"]))
    db.commit()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
