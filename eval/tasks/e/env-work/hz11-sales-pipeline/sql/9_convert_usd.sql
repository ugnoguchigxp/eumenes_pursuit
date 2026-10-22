-- USD cents -> yen at the rate of the business month, rounded half up to the yen.
-- Only rows not converted yet, so the step is safe to run twice.
UPDATE sales
SET amount_yen = (amount_minor * (SELECT rate_x100 FROM rates WHERE rates.month = sales.biz_month) + 5000) / 10000
WHERE currency = 'USD' AND amount_yen IS NULL;
