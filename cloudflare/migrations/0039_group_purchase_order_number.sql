-- Existing purchases retain NULL; preserve their amounts and relationships.
ALTER TABLE "GroupPurchase" ADD COLUMN "orderNumber" TEXT;
CREATE UNIQUE INDEX "GroupPurchase_orderNumber_key" ON "GroupPurchase"("orderNumber");
