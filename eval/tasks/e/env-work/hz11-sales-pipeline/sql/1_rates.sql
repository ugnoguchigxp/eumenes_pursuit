-- Monthly USD/JPY rates in hundredths of a yen (143.27 -> 14327), exact integer arithmetic.
CREATE TABLE rates (month TEXT PRIMARY KEY, rate_x100 INTEGER NOT NULL);
INSERT INTO rates
SELECT month,
       CAST(substr(usdjpy, 1, instr(usdjpy, '.') - 1) AS INTEGER) * 100
       + CAST(substr(usdjpy || '00', instr(usdjpy, '.') + 1, 2) AS INTEGER)
FROM raw_rates;
