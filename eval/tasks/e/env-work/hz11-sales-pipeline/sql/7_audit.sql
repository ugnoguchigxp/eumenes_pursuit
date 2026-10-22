-- Row counts per export file, for the operations log.
CREATE TABLE audit AS SELECT source, COUNT(*) AS rows FROM sales GROUP BY source;
