-- Atomicity is supplied by applyMigrations/storage.transactionSync.
-- Archive retired events without deleting message content or prior history.
-- PENDING is suppressed; PROCESSING/SENDING is conservatively quarantined.
INSERT INTO "EmailOutboxHistory" ("id","outboxId","status","sequence","attempt","code","provider")
SELECT 'email-retirement-v24:' || e."id", e."id",
  CASE WHEN e."status" = 'PENDING' THEN 'SKIPPED' ELSE 'DELIVERY_UNCERTAIN' END,
  COALESCE((SELECT MAX(h."sequence") FROM "EmailOutboxHistory" h WHERE h."outboxId" = e."id"), -1) + 1,
  e."attempts",
  CASE WHEN e."status" = 'PENDING' THEN 'EMAIL_BUSINESS_EMAILS_RETIRED' ELSE 'EMAIL_RETIREMENT_DELIVERY_UNCERTAIN' END,
  e."provider"
FROM "EmailOutbox" e
WHERE e."eventType" IN ('PAY_NOW_CONFIRMED','RESERVE_NOW_RESERVED','DEPOSIT_RECEIVED','GROUP_PURCHASE_SUCCESSFUL','BOOKING_CANCELLED','BOOKING_RESCHEDULED','REFUND_COMPLETED') AND e."status" IN ('PENDING','PROCESSING','SENDING')
ON CONFLICT ("id") DO NOTHING;

UPDATE "EmailOutbox"
SET "status" = CASE WHEN "status" = 'PENDING' THEN 'SKIPPED' ELSE 'DELIVERY_UNCERTAIN' END,
  "skipReason" = CASE WHEN "status" = 'PENDING' THEN 'EMAIL_BUSINESS_EMAILS_RETIRED' ELSE "skipReason" END,
  "lastError" = COALESCE("lastError", CASE WHEN "status" = 'PENDING' THEN 'EMAIL_BUSINESS_EMAILS_RETIRED' ELSE 'EMAIL_RETIREMENT_DELIVERY_UNCERTAIN' END),
  "terminalAt" = COALESCE("terminalAt", CURRENT_TIMESTAMP), "claimToken" = NULL, "lockedUntil" = NULL
WHERE "eventType" IN ('PAY_NOW_CONFIRMED','RESERVE_NOW_RESERVED','DEPOSIT_RECEIVED','GROUP_PURCHASE_SUCCESSFUL','BOOKING_CANCELLED','BOOKING_RESCHEDULED','REFUND_COMPLETED') AND "status" IN ('PENDING','PROCESSING','SENDING');
