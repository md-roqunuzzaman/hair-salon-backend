/*
  Warnings:

  - You are about to alter the column `eligiblePaidAmount` on the `RefundRequest` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `Decimal(10,2)`.
  - You are about to alter the column `refundDeduction` on the `RefundRequest` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "RefundRequest" ALTER COLUMN "eligiblePaidAmount" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "refundDeduction" SET DATA TYPE DECIMAL(10,2);
