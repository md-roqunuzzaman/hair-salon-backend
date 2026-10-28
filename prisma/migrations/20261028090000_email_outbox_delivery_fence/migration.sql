ALTER TABLE "EmailOutbox" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "attemptedAt" TIMESTAMP(3);
ALTER TABLE "EmailOutbox" ADD COLUMN "text" TEXT;
UPDATE "EmailOutbox" SET "status" = 'DELIVERY_UNCERTAIN', "lockedUntil" = NULL,
  "lastError" = 'EMAIL_LEGACY_ATTEMPT_UNCERTAIN'
WHERE "status" = 'PROCESSING' OR ("status" = 'PENDING' AND "attempts" > 0);
