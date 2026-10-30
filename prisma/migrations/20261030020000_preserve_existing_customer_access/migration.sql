-- Grandfather only customers created before the original verification-schema
-- migration began. Verified read-only on both configured PostgreSQL connections:
-- 20261030014939_add_email_verification started at
-- 2026-10-30 01:49:40.572383+00 (UTC).
-- Use a fixed historical cutoff: shadow replay has no application migration
-- ledger. User.createdAt is a UTC timestamp without time zone; retain the full
-- cutoff precision and avoid session-timezone-dependent casts.
-- This deployment's cutoff must be verified before reuse on another database.
-- New registrations and historical emailVerifiedAt values remain unchanged.
BEGIN;
UPDATE "User" SET "emailVerified" = true
WHERE "role" = 'CUSTOMER' AND "emailVerified" = false
  AND "createdAt" < TIMESTAMP '2026-10-30 01:49:40.572383';
COMMIT;
