-- =====================================================
-- 1. CREATE ENUMS
-- =====================================================

CREATE TYPE "RefundCalculationType" AS ENUM ('PERCENTAGE', 'FIXED');

CREATE TYPE "RefundRequestType" AS ENUM (
    'APPOINTMENT_CANCELLATION',
    'GROUP_PURCHASE_REFUND'
);

CREATE TYPE "EntitlementCancellationOutcome" AS ENUM (
    'RESTORED',
    'FORFEITED'
);


-- =====================================================
-- 2. APPOINTMENT POLICY SNAPSHOT
-- =====================================================

ALTER TABLE "Appointment"
ADD COLUMN "cancellationPolicySnapshot" JSONB,
ADD COLUMN "cancellationPolicyVersion" INTEGER,
ADD COLUMN "entitlementCancellationOutcome" "EntitlementCancellationOutcome";


-- =====================================================
-- 3. GROUP PURCHASE POLICY & ENTITLEMENT
-- =====================================================

ALTER TABLE "GroupPurchase"
ADD COLUMN "cancellationPolicySnapshot" JSONB,
ADD COLUMN "cancellationPolicyVersion" INTEGER,
ADD COLUMN "refundPolicySnapshot" JSONB,
ADD COLUMN "refundPolicyVersion" INTEGER,
ADD COLUMN "forfeitedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedQuantity" INTEGER NOT NULL DEFAULT 0;


-- =====================================================
-- 4. REFUND REQUEST EXTENSION
-- =====================================================

ALTER TABLE "RefundRequest"
ADD COLUMN "requestType" "RefundRequestType"
    NOT NULL DEFAULT 'APPOINTMENT_CANCELLATION',
ADD COLUMN "policySnapshot" JSONB,
ADD COLUMN "policyVersion" INTEGER,
ADD COLUMN "eligiblePaidAmount" DECIMAL(12,2),
ADD COLUMN "refundPercentage" DECIMAL(5,2),
ADD COLUMN "refundDeduction" DECIMAL(12,2),
ADD COLUMN "isCancellationOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "policyEvaluatedAt" TIMESTAMP(3),
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "RefundRequest_idempotencyKey_key"
ON "RefundRequest"("idempotencyKey");


-- =====================================================
-- 5. BRANCH CANCELLATION POLICY
-- =====================================================

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


-- =====================================================
-- 6. GROUP PURCHASE REFUND POLICY
-- =====================================================

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


-- =====================================================
-- 7. GROUP PURCHASE CANCELLATION POLICY
-- =====================================================

CREATE TABLE "GroupPurchaseCancellationPolicy" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "restorationMinimumHours" INTEGER NOT NULL DEFAULT 24,
    "lateCancellationOutcome" "EntitlementCancellationOutcome"
        NOT NULL DEFAULT 'FORFEITED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPurchaseCancellationPolicy_pkey" PRIMARY KEY ("id")
);


-- =====================================================
-- 8. UNIQUE INDEXES
-- =====================================================

CREATE UNIQUE INDEX "BranchCancellationPolicy_branchId_key"
ON "BranchCancellationPolicy"("branchId");

CREATE UNIQUE INDEX "GroupPurchaseRefundPolicy_packageId_key"
ON "GroupPurchaseRefundPolicy"("packageId");

CREATE UNIQUE INDEX "GroupPurchaseCancellationPolicy_packageId_key"
ON "GroupPurchaseCancellationPolicy"("packageId");


-- =====================================================
-- 9. FOREIGN KEYS
-- =====================================================

ALTER TABLE "BranchCancellationPolicy"
ADD CONSTRAINT "BranchCancellationPolicy_branchId_fkey"
FOREIGN KEY ("branchId")
REFERENCES "Branch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupPurchaseRefundPolicy"
ADD CONSTRAINT "GroupPurchaseRefundPolicy_packageId_fkey"
FOREIGN KEY ("packageId")
REFERENCES "Package"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupPurchaseCancellationPolicy"
ADD CONSTRAINT "GroupPurchaseCancellationPolicy_packageId_fkey"
FOREIGN KEY ("packageId")
REFERENCES "Package"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "RefundRequest"
SET "requestType" = 'GROUP_PURCHASE_REFUND'
WHERE "id" = '1cfcf2bc-9d2b-4fb2-847c-aa3bfa02e025';