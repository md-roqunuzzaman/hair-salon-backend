-- Explicit mapping authorized by the user; all unmapped/conflicting rows require review.
BEGIN;
-- Keep the mapping preflight and ownership conversion on the same stable rows.
LOCK TABLE "GroupPurchaseRefundPolicy", "GroupPurchaseCancellationPolicy", "PackageBranch", "Branch" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM "GroupPurchaseRefundPolicy" p WHERE p."packageId" <> '9ff78b23-f681-4007-a44c-ef4277decf17' OR NOT EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId" WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')) OR
EXISTS (SELECT 1 FROM "GroupPurchaseCancellationPolicy" p WHERE p."packageId" <> '9ff78b23-f681-4007-a44c-ef4277decf17' OR NOT EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId" WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')) THEN RAISE EXCEPTION 'GROUP_POLICY_BRANCH_MAPPING_REQUIRES_REVIEW'; END IF;
END $$;

ALTER TABLE "GroupPurchaseRefundPolicy" DROP CONSTRAINT "GroupPurchaseRefundPolicy_packageId_fkey";
DROP INDEX "GroupPurchaseRefundPolicy_packageId_key";
ALTER TABLE "GroupPurchaseRefundPolicy" RENAME COLUMN "packageId" TO "branchId";
UPDATE "GroupPurchaseRefundPolicy" SET "branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97';
CREATE UNIQUE INDEX "GroupPurchaseRefundPolicy_branchId_key" ON "GroupPurchaseRefundPolicy"("branchId");
ALTER TABLE "GroupPurchaseRefundPolicy" ADD CONSTRAINT "GroupPurchaseRefundPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupPurchaseCancellationPolicy" DROP CONSTRAINT "GroupPurchaseCancellationPolicy_packageId_fkey";
DROP INDEX "GroupPurchaseCancellationPolicy_packageId_key";
ALTER TABLE "GroupPurchaseCancellationPolicy" RENAME COLUMN "packageId" TO "branchId";
UPDATE "GroupPurchaseCancellationPolicy" SET "branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97';
CREATE UNIQUE INDEX "GroupPurchaseCancellationPolicy_branchId_key" ON "GroupPurchaseCancellationPolicy"("branchId");
ALTER TABLE "GroupPurchaseCancellationPolicy" ADD CONSTRAINT "GroupPurchaseCancellationPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
