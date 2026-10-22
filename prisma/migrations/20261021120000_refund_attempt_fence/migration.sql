ALTER TABLE "Refund" ADD COLUMN "refundClaimToken" TEXT,
ADD COLUMN "refundClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN "refundAttemptedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Refund_refundClaimToken_key" ON "Refund"("refundClaimToken");
-- Legacy late refunds may already have reached Stripe, even without a saved provider ID.
UPDATE "Refund" SET "refundAttemptedAt" = "createdAt" WHERE "reason" = 'LATE_GROUP_PURCHASE_PAYMENT';
