-- Preserve the parent table, financial relations, indexes and money triggers.
-- Enumerate at most N candidates for N appointments. Existing codes can occupy
-- at most N - missing slots, leaving enough distinct codes for every NULL.
-- Backfill is deterministic; normal booking creation still uses random codes.
WITH RECURSIVE
  missing AS MATERIALIZED (
    SELECT id, row_number() OVER (ORDER BY id) AS position
    FROM Appointment WHERE orderNumber IS NULL
  ),
  sequence(n) AS (
    SELECT 0 WHERE EXISTS (SELECT 1 FROM missing)
    UNION ALL
    SELECT n + 1 FROM sequence
    WHERE n + 1 < (SELECT count(*) FROM Appointment) AND n + 1 < 1073741824
  ),
  candidates AS (
    SELECT n,
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 33554432) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 1048576) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 32768) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 1024) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (n / 32) % 32 + 1, 1) ||
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', n % 32 + 1, 1) AS code
    FROM sequence
  ),
  available AS MATERIALIZED (
    SELECT code, row_number() OVER (ORDER BY n) AS position FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM Appointment WHERE orderNumber = candidates.code)
  )
UPDATE Appointment SET orderNumber = (
  SELECT available.code FROM available JOIN missing USING (position)
  WHERE missing.id = Appointment.id
) WHERE orderNumber IS NULL;

-- Fail atomically if the six-character namespace could not satisfy the backfill.
CREATE TABLE _AppointmentOrderNumberGuard (ok INTEGER CHECK (ok = 1));
INSERT INTO _AppointmentOrderNumberGuard
SELECT CASE WHEN EXISTS (SELECT 1 FROM Appointment WHERE orderNumber IS NULL) THEN 0 ELSE 1 END;
DROP TABLE _AppointmentOrderNumberGuard;

-- Equivalent required-field enforcement without rebuilding a referenced table.
CREATE TRIGGER "required_Appointment_orderNumber_INSERT" BEFORE INSERT ON "Appointment"
WHEN NEW."orderNumber" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: Appointment.orderNumber');
END;

CREATE TRIGGER "required_Appointment_orderNumber_UPDATE" BEFORE UPDATE ON "Appointment"
WHEN NEW."orderNumber" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: Appointment.orderNumber');
END;
