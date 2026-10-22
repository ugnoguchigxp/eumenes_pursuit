"""Stage 2: run the SQL steps in sql/ in order (docs/sql-steps.md)."""
import os
import sqlite3
import sys


def main(sql_dir: str, db_path: str) -> None:
    db = sqlite3.connect(db_path)
    names = [n for n in os.listdir(sql_dir) if n.endswith(".sql")]
    for name in sorted(names):
        with open(os.path.join(sql_dir, name), encoding="utf-8") as f:
            db.executescript(f.read())
    db.commit()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
