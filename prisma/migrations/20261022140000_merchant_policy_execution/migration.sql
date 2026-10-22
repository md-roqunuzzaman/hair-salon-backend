-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "cancellationIdempotencyKey" TEXT,
ADD COLUMN     "cancellationResult" JSONB;

-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN     "purchaseBranchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_cancellationIdempotencyKey_key" ON "Appointment"("cancellationIdempotencyKey");

-- AddForeignKey
ALTER TABLE "GroupPurchase" ADD CONSTRAINT "GroupPurchase_purchaseBranchId_fkey" FOREIGN KEY ("purchaseBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing tier rows keep their original refundable-value semantics.
ALTER TABLE "BranchCancellationPolicy" ADD COLUMN "refundAllowed" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "policyFormat" TEXT NOT NULL DEFAULT 'REFUND_TIERS_V1';
ALTER TABLE "GroupPurchaseRefundPolicy" ADD COLUMN "policyFormat" TEXT NOT NULL DEFAULT 'REFUND_TIERS_V1', ADD COLUMN "boundaryMode" TEXT NOT NULL DEFAULT 'MINIMUM_INCLUSIVE';
