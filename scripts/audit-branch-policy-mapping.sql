-- READ ONLY. Run against the pre-v11 database before rollout.
-- Policies not covered by this user-approved mapping need an explicit decision.
SELECT 'REFUND' AS policyType, p."id", p."packageId", p."version",
  (SELECT COUNT(*) FROM "PackageBranch" pb WHERE pb."packageId"=p."packageId") AS assignedBranchCount,
  CASE WHEN p."packageId"='9ff78b23-f681-4007-a44c-ef4277decf17'
    AND EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId"
      WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')
    THEN 'MAPPED_TO_f7318524-db7c-49cf-8bc4-bfc6ff5c6b97' ELSE 'REQUIRES_MANUAL_MAPPING' END AS mappingStatus
FROM "GroupPurchaseRefundPolicy" p
UNION ALL
SELECT 'CANCELLATION', p."id", p."packageId", p."version",
  (SELECT COUNT(*) FROM "PackageBranch" pb WHERE pb."packageId"=p."packageId"),
  CASE WHEN p."packageId"='9ff78b23-f681-4007-a44c-ef4277decf17'
    AND EXISTS (SELECT 1 FROM "PackageBranch" pb JOIN "Branch" b ON b."id"=pb."branchId"
      WHERE pb."packageId"=p."packageId" AND pb."branchId"='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97')
    THEN 'MAPPED_TO_f7318524-db7c-49cf-8bc4-bfc6ff5c6b97' ELSE 'REQUIRES_MANUAL_MAPPING' END
FROM "GroupPurchaseCancellationPolicy" p;
