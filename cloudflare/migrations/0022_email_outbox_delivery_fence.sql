ALTER TABLE "EmailOutbox" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "attemptedAt" DATETIME;
ALTER TABLE "EmailOutbox" ADD COLUMN "text" TEXT;
-- Existing abandoned attempts cannot safely be assumed undelivered.
UPDATE "EmailOutbox" SET "status" = 'DELIVERY_UNCERTAIN', "lockedUntil" = NULL,
  "lastError" = 'EMAIL_LEGACY_ATTEMPT_UNCERTAIN'
WHERE "status" = 'PROCESSING' OR ("status" = 'PENDING' AND "attempts" > 0);
