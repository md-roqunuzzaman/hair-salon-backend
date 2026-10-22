ALTER TABLE "GroupPurchase" ADD COLUMN "settledPaymentId" TEXT;
CREATE UNIQUE INDEX "GroupPurchase_settledPaymentId_key" ON "GroupPurchase"("settledPaymentId");
ALTER TABLE "GroupPurchase" ADD CONSTRAINT "GroupPurchase_settledPaymentId_fkey" FOREIGN KEY ("settledPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE "GroupPurchase" g SET "settledPaymentId" = (
 SELECT MIN(p."id") FROM "Payment" p WHERE p."groupPurchaseId" = g."id" AND p."purpose" = 'GROUP_PURCHASE' AND p."provider" IN ('STRIPE', 'WALLET') AND p."status" = 'PAID'
) WHERE g."purchasedAt" IS NOT NULL AND (
 SELECT COUNT(*) FROM "Payment" p WHERE p."groupPurchaseId" = g."id" AND p."purpose" = 'GROUP_PURCHASE' AND p."provider" IN ('STRIPE', 'WALLET') AND p."status" = 'PAID'
) = 1;
