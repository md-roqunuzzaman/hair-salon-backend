ALTER TABLE "Refund" ADD COLUMN "refundClaimToken" TEXT;
ALTER TABLE "Refund" ADD COLUMN "refundClaimExpiresAt" DATETIME;
ALTER TABLE "Refund" ADD COLUMN "refundAttemptedAt" DATETIME;
CREATE UNIQUE INDEX "Refund_refundClaimToken_key" ON "Refund"("refundClaimToken");
UPDATE "Refund" SET "refundAttemptedAt" = "createdAt" WHERE "reason" = 'LATE_GROUP_PURCHASE_PAYMENT';
