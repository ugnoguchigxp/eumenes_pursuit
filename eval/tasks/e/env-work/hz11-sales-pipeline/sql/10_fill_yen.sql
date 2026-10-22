-- Rows already in yen.
UPDATE sales SET amount_yen = amount_minor WHERE amount_yen IS NULL;
