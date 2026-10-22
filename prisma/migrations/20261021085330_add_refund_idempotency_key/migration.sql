/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Refund` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTopup_promotionId_idx" ON "WalletTopup"("promotionId");
