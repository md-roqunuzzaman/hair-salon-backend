-- Explicit mapping authorized by the user. Unmapped policies abort before any table changes.
-- Package 9ff78b23-f681-4007-a44c-ef4277decf17 -> branch f7318524-db7c-49cf-8bc4-bfc6ff5c6b97.
CREATE TABLE "_GroupPolicyBranchMappingGuard" ("ok" INTEGER CONSTRAINT "GROUP_POLICY_BRANCH_MAPPING_REQUIRES_REVIEW" CHECK ("ok" = 1));
INSERT INTO "_GroupPolicyBranchMappingGuard" SELECT CASE WHEN EXISTS (SELECT 1 FROM "GroupPurchaseRefundPolicy" p WHERE p."packageId" <> '9ff78b23-f681-4007-a44c-ef4277decf17' OR NOT EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId" WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')) OR
EXISTS (SELECT 1 FROM "GroupPurchaseCancellationPolicy" p WHERE p."packageId" <> '9ff78b23-f681-4007-a44c-ef4277decf17' OR NOT EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId" WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')) THEN 0 ELSE 1 END;
DROP TABLE "_GroupPolicyBranchMappingGuard";

CREATE TABLE "_new_GroupPurchaseRefundPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "refundAllowed" BOOLEAN NOT NULL DEFAULT true,
    "refundTiers" JSONB NOT NULL,
    "allowPartiallyUsedRefund" BOOLEAN NOT NULL DEFAULT false,
    "allowExpiredRefund" BOOLEAN NOT NULL DEFAULT false,
    "requireNoActiveAppointments" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPurchaseRefundPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_new_GroupPurchaseRefundPolicy" ("id","branchId","isEnabled","refundAllowed","refundTiers","allowPartiallyUsedRefund","allowExpiredRefund","requireNoActiveAppointments","version","createdAt","updatedAt") SELECT "id",'f7318524-db7c-49cf-8bc4-bfc6ff5c6b97',"isEnabled","refundAllowed","refundTiers","allowPartiallyUsedRefund","allowExpiredRefund","requireNoActiveAppointments","version","createdAt","updatedAt" FROM "GroupPurchaseRefundPolicy";
DROP TABLE "GroupPurchaseRefundPolicy";
ALTER TABLE "_new_GroupPurchaseRefundPolicy" RENAME TO "GroupPurchaseRefundPolicy";
CREATE UNIQUE INDEX "GroupPurchaseRefundPolicy_branchId_key" ON "GroupPurchaseRefundPolicy"("branchId");

CREATE TABLE "_new_GroupPurchaseCancellationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancellationAllowed" BOOLEAN NOT NULL DEFAULT true,
    "minimumCancellationHours" INTEGER NOT NULL DEFAULT 2,
    "restorationMinimumHours" INTEGER NOT NULL DEFAULT 24,
    "lateCancellationOutcome" TEXT NOT NULL DEFAULT 'FORFEITED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPurchaseCancellationPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_new_GroupPurchaseCancellationPolicy" ("id","branchId","isEnabled","cancellationAllowed","minimumCancellationHours","restorationMinimumHours","lateCancellationOutcome","version","createdAt","updatedAt") SELECT "id",'f7318524-db7c-49cf-8bc4-bfc6ff5c6b97',"isEnabled","cancellationAllowed","minimumCancellationHours","restorationMinimumHours","lateCancellationOutcome","version","createdAt","updatedAt" FROM "GroupPurchaseCancellationPolicy";
DROP TABLE "GroupPurchaseCancellationPolicy";
ALTER TABLE "_new_GroupPurchaseCancellationPolicy" RENAME TO "GroupPurchaseCancellationPolicy";
CREATE UNIQUE INDEX "GroupPurchaseCancellationPolicy_branchId_key" ON "GroupPurchaseCancellationPolicy"("branchId");
