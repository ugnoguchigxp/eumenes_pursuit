"""Stage 4: write out/report.txt (docs/report.md)."""
import sqlite3
import sys


def main(db_path: str, out_path: str) -> None:
    db = sqlite3.connect(db_path)
    lines = []
    for branch, month, total in db.execute(
        "SELECT branch, biz_month, SUM(amount_yen) FROM clean GROUP BY branch, biz_month ORDER BY branch, biz_month"
    ):
        lines.append(f"MONTHLY {branch} {month} {total}")
    for (branch,) in db.execute("SELECT DISTINCT branch FROM clean ORDER BY branch"):
        category, total = db.execute(
            "SELECT category, SUM(amount_yen) t FROM clean WHERE branch = ? GROUP BY category ORDER BY t DESC, category LIMIT 1",
            (branch,),
        ).fetchone()
        lines.append(f"TOP {branch} {category} {total}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
