-- Additive upgrade: keep existing money triggers, relationships and historical terms intact.
-- Historical purchase branch/snapshots remain null. No inferred branch or policy backfill.
ALTER TABLE "BranchCancellationPolicy" ADD COLUMN "refundAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BranchCancellationPolicy" ADD COLUMN "policyFormat" TEXT NOT NULL DEFAULT 'REFUND_TIERS_V1';
ALTER TABLE "GroupPurchaseRefundPolicy" ADD COLUMN "policyFormat" TEXT NOT NULL DEFAULT 'REFUND_TIERS_V1';
ALTER TABLE "GroupPurchaseRefundPolicy" ADD COLUMN "boundaryMode" TEXT NOT NULL DEFAULT 'MINIMUM_INCLUSIVE';
ALTER TABLE "GroupPurchase" ADD COLUMN "purchaseBranchId" TEXT REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD COLUMN "cancellationIdempotencyKey" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "cancellationResult" JSONB;
CREATE UNIQUE INDEX "Appointment_cancellationIdempotencyKey_key" ON "Appointment"("cancellationIdempotencyKey");
