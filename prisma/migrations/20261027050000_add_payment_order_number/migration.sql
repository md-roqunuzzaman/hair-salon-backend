ALTER TABLE "Payment" ADD COLUMN "orderNumber" TEXT;
CREATE UNIQUE INDEX "Payment_orderNumber_key" ON "Payment"("orderNumber");
