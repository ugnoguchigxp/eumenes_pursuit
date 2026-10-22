-- For ad-hoc checks only; the report does not use these views.
CREATE VIEW daily AS SELECT branch, biz_date, COUNT(*) n FROM sales GROUP BY branch, biz_date;
CREATE VIEW unconverted AS SELECT * FROM sales WHERE amount_yen IS NULL;
