ALTER TABLE "GroupPurchase" ADD COLUMN "purchaseFlow" TEXT NOT NULL DEFAULT 'BUY_NOW_BOOK_LATER';
ALTER TABLE "GroupPurchase" ADD COLUMN "bookingMethod" TEXT;
ALTER TABLE "GroupPurchase" ADD COLUMN "depositPercentage" BIGINT;
ALTER TABLE "GroupPurchase" ADD COLUMN "depositAmount" BIGINT;
ALTER TABLE "GroupPurchase" ADD COLUMN "remainingAmount" BIGINT;
ALTER TABLE "Refund" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "WalletTopup_promotionId_idx" ON "WalletTopup"("promotionId");
