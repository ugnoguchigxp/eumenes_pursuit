"""Stage 3: drop rows that appear in more than one export (overlapping export periods)."""
import sqlite3
import sys


def main(db_path: str) -> None:
    db = sqlite3.connect(db_path)
    db.executescript(
        """
        CREATE TABLE clean AS
        SELECT * FROM sales
        WHERE rowid IN (SELECT MIN(rowid) FROM sales GROUP BY branch, receipt_no);
        """
    )
    db.commit()


if __name__ == "__main__":
    main(sys.argv[1])
