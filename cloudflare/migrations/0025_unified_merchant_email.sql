-- Preserve all historical outbox rows, histories, credentials and verification.
-- The cutoff records deployment initialization; old skipped jobs are never replayed.
ALTER TABLE "Notification" ADD COLUMN "emailIntent" JSONB;
ALTER TABLE "Appointment" ADD COLUMN "emailPaymentConfirmedAt" DATETIME;
ALTER TABLE "GroupPurchase" ADD COLUMN "emailPurchaseConfirmedAt" DATETIME;
CREATE TABLE "EmailEventCursor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "afterAt" DATETIME,
  "afterId" TEXT
);
INSERT INTO "EmailEventCursor" ("id") VALUES
 ('RESERVATIONS'),('APPOINTMENT_PAYMENTS'),('GROUP_PAYMENTS'),
 ('CANCELLATIONS'),('RESCHEDULES'),('REFUNDS');
