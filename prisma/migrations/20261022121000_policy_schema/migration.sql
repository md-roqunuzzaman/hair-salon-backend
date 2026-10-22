-- CreateEnum
CREATE TYPE "RefundCalculationType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "RefundRequestType" AS ENUM ('APPOINTMENT_CANCELLATION', 'GROUP_PURCHASE_REFUND');

-- CreateEnum
CREATE TYPE "EntitlementCancellationOutcome" AS ENUM ('RESTORED', 'FORFEITED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "cancellationPolicySnapshot" JSONB,
ADD COLUMN     "cancellationPolicyVersion" INTEGER,
ADD COLUMN     "entitlementCancellationOutcome" "EntitlementCancellationOutcome";

-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN     "cancellationPolicySnapshot" JSONB,
ADD COLUMN     "cancellationPolicyVersion" INTEGER,
ADD COLUMN     "refundPolicySnapshot" JSONB,
ADD COLUMN     "refundPolicyVersion" INTEGER;

-- CreateTable
CREATE TABLE "BranchCancellationPolicy" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "refundTiers" JSONB NOT NULL,
    "nonRefundable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchCancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPurchaseRefundPolicy" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "refundAllowed" BOOLEAN NOT NULL DEFAULT true,
    "refundTiers" JSONB NOT NULL,
    "allowPartiallyUsedRefund" BOOLEAN NOT NULL DEFAULT false,
    "allowExpiredRefund" BOOLEAN NOT NULL DEFAULT false,
    "requireNoActiveAppointments" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPurchaseRefundPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPurchaseCancellationPolicy" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "restorationMinimumHours" INTEGER NOT NULL DEFAULT 24,
    "forfeitOnLateCancellation" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPurchaseCancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchCancellationPolicy_branchId_key" ON "BranchCancellationPolicy"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPurchaseRefundPolicy_packageId_key" ON "GroupPurchaseRefundPolicy"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPurchaseCancellationPolicy_packageId_key" ON "GroupPurchaseCancellationPolicy"("packageId");

-- AddForeignKey
ALTER TABLE "BranchCancellationPolicy" ADD CONSTRAINT "BranchCancellationPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPurchaseRefundPolicy" ADD CONSTRAINT "GroupPurchaseRefundPolicy_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPurchaseCancellationPolicy" ADD CONSTRAINT "GroupPurchaseCancellationPolicy_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
