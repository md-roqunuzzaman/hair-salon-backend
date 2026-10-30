-- Keep the supplied verification-schema migration immutable. Grandfather only
-- customers predating its application, including when that schema migration
-- was applied separately. New registrations remain unverified. Do not invent
-- historical emailVerifiedAt timestamps.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '20261030014939_add_email_verification'
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Email verification schema migration must be applied first';
  END IF;
END $$;
UPDATE "User" SET "emailVerified" = true
WHERE "role" = 'CUSTOMER' AND "emailVerified" = false
  AND "createdAt" < (
    SELECT "started_at" FROM "_prisma_migrations"
    WHERE "migration_name" = '20261030014939_add_email_verification'
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    ORDER BY "started_at" DESC LIMIT 1
  );
COMMIT;
