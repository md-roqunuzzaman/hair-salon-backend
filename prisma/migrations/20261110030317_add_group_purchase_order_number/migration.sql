/*
  Warnings:

  - A unique constraint covering the columns `[orderNumber]` on the table `GroupPurchase` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN     "orderNumber" VARCHAR(6);

-- CreateIndex
CREATE UNIQUE INDEX "GroupPurchase_orderNumber_key" ON "GroupPurchase"("orderNumber");
