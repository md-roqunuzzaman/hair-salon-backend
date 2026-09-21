/*
  Warnings:

  - The values [SOLD_OUT] on the enum `PackageStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- AlterEnum
BEGIN;
CREATE TYPE "PackageStatus_new" AS ENUM ('ACTIVE', 'INACTIVE');
ALTER TABLE "public"."Package" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Package" ALTER COLUMN "status" TYPE "PackageStatus_new" USING ("status"::text::"PackageStatus_new");
ALTER TYPE "PackageStatus" RENAME TO "PackageStatus_old";
ALTER TYPE "PackageStatus_new" RENAME TO "PackageStatus";
DROP TYPE "public"."PackageStatus_old";
ALTER TABLE "Package" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GroupPurchase" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reservationExpiresAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupPurchase_customerId_idx" ON "GroupPurchase"("customerId");

-- CreateIndex
CREATE INDEX "GroupPurchase_packageId_idx" ON "GroupPurchase"("packageId");

-- CreateIndex
CREATE INDEX "GroupPurchase_paymentStatus_idx" ON "GroupPurchase"("paymentStatus");

-- CreateIndex
CREATE INDEX "GroupPurchase_reservationExpiresAt_idx" ON "GroupPurchase"("reservationExpiresAt");

-- AddForeignKey
ALTER TABLE "GroupPurchase" ADD CONSTRAINT "GroupPurchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPurchase" ADD CONSTRAINT "GroupPurchase_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
