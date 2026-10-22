-- Business day of the sale.
UPDATE sales SET biz_date = date(sold_at);
UPDATE sales SET biz_month = substr(biz_date, 1, 7);
