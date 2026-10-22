ALTER TABLE "GroupPurchase" ADD COLUMN "settledPaymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "GroupPurchase_settledPaymentId_key" ON "GroupPurchase"("settledPaymentId");
-- Backfill only purchases with exactly one successful non-salon initial payment.
UPDATE "GroupPurchase" SET "settledPaymentId" = (
  SELECT MIN(p."id") FROM "Payment" p WHERE p."groupPurchaseId" = "GroupPurchase"."id"
  AND p."purpose" = 'GROUP_PURCHASE' AND p."provider" IN ('STRIPE', 'WALLET') AND p."status" = 'PAID'
) WHERE "purchasedAt" IS NOT NULL AND (
  SELECT COUNT(*) FROM "Payment" p WHERE p."groupPurchaseId" = "GroupPurchase"."id"
  AND p."purpose" = 'GROUP_PURCHASE' AND p."provider" IN ('STRIPE', 'WALLET') AND p."status" = 'PAID'
) = 1;
