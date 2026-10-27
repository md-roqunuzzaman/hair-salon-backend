-- Fill historical NULL codes once, without modifying payment amounts or links.
-- Each candidate contains a letter and a digit. Existing codes are skipped.
-- N candidates suffice for N payments, subject to the namespace capacity.
WITH RECURSIVE
  missing AS MATERIALIZED (
    SELECT id, row_number() OVER (ORDER BY id) AS position
    FROM Payment WHERE orderNumber IS NULL
  ),
  sequence(n) AS (
    SELECT 0 WHERE EXISTS (SELECT 1 FROM missing)
    UNION ALL
    SELECT n + 1 FROM sequence
    WHERE n + 1 < (SELECT count(*) FROM Payment) AND n + 1 < 201326592
  ),
  candidates AS (
    SELECT n,
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ', (n / 8388608) % 24 + 1, 1) ||
      substr('23456789', (n / 1048576) % 8 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 32768) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 1024) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 32) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', n % 32 + 1, 1) AS code
    FROM sequence
  ),
  available AS MATERIALIZED (
    SELECT code, row_number() OVER (ORDER BY n) AS position FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM Payment WHERE orderNumber = candidates.code)
  )
UPDATE Payment SET orderNumber = (
  SELECT available.code FROM available JOIN missing USING (position)
  WHERE missing.id = Payment.id
) WHERE orderNumber IS NULL;

-- Abort the transaction rather than leave a partial backfill.
CREATE TABLE _PaymentOrderNumberBackfillGuard (ok INTEGER CHECK (ok = 1));
INSERT INTO _PaymentOrderNumberBackfillGuard
SELECT CASE WHEN EXISTS (SELECT 1 FROM Payment WHERE orderNumber IS NULL) THEN 0 ELSE 1 END;
DROP TABLE _PaymentOrderNumberBackfillGuard;
