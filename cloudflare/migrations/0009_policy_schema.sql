-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "cancellationPolicySnapshot" JSONB;
ALTER TABLE "Appointment" ADD COLUMN "cancellationPolicyVersion" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN "entitlementCancellationOutcome" TEXT;

-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN "cancellationPolicySnapshot" JSONB;
ALTER TABLE "GroupPurchase" ADD COLUMN "cancellationPolicyVersion" INTEGER;
ALTER TABLE "GroupPurchase" ADD COLUMN "refundPolicySnapshot" JSONB;
ALTER TABLE "GroupPurchase" ADD COLUMN "refundPolicyVersion" INTEGER;

-- CreateTable
CREATE TABLE "BranchCancellationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "refundTiers" JSONB NOT NULL,
    "nonRefundable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchCancellationPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupPurchaseRefundPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "refundAllowed" BOOLEAN NOT NULL DEFAULT true,
    "refundTiers" JSONB NOT NULL,
    "allowPartiallyUsedRefund" BOOLEAN NOT NULL DEFAULT false,
    "allowExpiredRefund" BOOLEAN NOT NULL DEFAULT false,
    "requireNoActiveAppointments" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPurchaseRefundPolicy_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupPurchaseCancellationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "restorationMinimumHours" INTEGER NOT NULL DEFAULT 24,
    "forfeitOnLateCancellation" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPurchaseCancellationPolicy_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchCancellationPolicy_branchId_key" ON "BranchCancellationPolicy"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPurchaseRefundPolicy_packageId_key" ON "GroupPurchaseRefundPolicy"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPurchaseCancellationPolicy_packageId_key" ON "GroupPurchaseCancellationPolicy"("packageId");
