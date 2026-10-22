-- Sanity: every row has a yen amount and a business day.
CREATE TABLE step_checks AS
SELECT (SELECT COUNT(*) FROM sales WHERE amount_yen IS NULL) AS missing_yen,
       (SELECT COUNT(*) FROM sales WHERE biz_date IS NULL) AS missing_day;
