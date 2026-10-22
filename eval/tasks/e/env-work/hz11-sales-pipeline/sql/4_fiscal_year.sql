-- Fiscal year starts on April 1 (by business day).
UPDATE sales SET fiscal_year = CASE WHEN CAST(substr(biz_date, 6, 2) AS INTEGER) >= 4
    THEN CAST(substr(biz_date, 1, 4) AS INTEGER)
    ELSE CAST(substr(biz_date, 1, 4) AS INTEGER) - 1 END;
