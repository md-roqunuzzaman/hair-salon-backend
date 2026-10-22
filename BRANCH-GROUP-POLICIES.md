# Branch group purchase policy conversion

Group Purchase Refund Policy and Group Purchase Cancellation Policy now belong to Branch through a required unique branchId. Package has no policy ownership relation. Branch retains its separate BranchCancellationPolicy and has optional inverse relations for the two group policies. All unrelated booking, payment, package assignment and historical snapshot fields remain unchanged.

## Prisma errors and relation ownership

The schema uses the split directory `prisma/schema`, configured in prisma.config.ts; there is no single prisma/schema.prisma file. At the start of this task the supplied errors no longer reproduced: Prisma validate passed. The current files had already gained opposite Package fields, but both policies still owned packageId while Branch pointed to shared policy IDs with Branch[] inverses. That valid intermediate structure did not enforce one policy per branch.

The reported missing-opposite error describes the earlier incomplete Package/policy relation. The reported Package__fkey collision describes conflicting generated relation constraints; the exact earlier broken declaration was not present in the inspected files, so its historical constraint definition is not verified. The fix removes obsolete Package policy relations rather than adding map names to preserve an incorrect design. Each policy now owns branchId @unique and references Branch.id; Branch contains only the optional inverse fields. No unrelated Package or Branch database constraint is renamed.

## Explicit existing data mapping

The user authorized this mapping for existing package-owned records:

| Source package | Target branch |
| --- | --- |
| 9ff78b23-f681-4007-a44c-ef4277decf17 | f7318524-db7c-49cf-8bc4-bfc6ff5c6b97 |

The mapping applies independently to any existing refund and cancellation policy for that package. It does not copy a policy to every assigned branch and does not pick the first package branch. A multi-branch package retains all of its assignments. Other branches can configure their own policies through the branch endpoints.

Migration guards reject any policy for another package, a missing target branch or a missing PackageBranch assignment to the authorized target. On Cloudflare the migration and migration-ledger entry run in one Durable Object storage transaction. Rejection leaves the old tables, rows and migration version intact. PostgreSQL SQL wraps its guard and conversion in BEGIN/COMMIT. No source policy is silently discarded or merged. IDs, all policy settings, versions and timestamps are copied unchanged; only the ownership key changes.

Run the read-only [mapping audit](scripts/audit-branch-policy-mapping.sql) against the pre-upgrade database before rollout. No staging or production database was queried in this task. Only the supplied mapping is confirmed; any additional rows reported as REQUIRES_MANUAL_MAPPING need an explicit target and conflict decision before migration. The guard prevents deploying an arbitrary choice.

## Migrations and readiness

- Cloudflare: `cloudflare/migrations/0011_branch_group_purchase_policies.sql`, registered after immutable v1-v10. The SQLite table conversion copies all policy rows before replacing their old tables inside the enclosing transaction. Fresh databases with no policies upgrade without requiring the staging UUIDs to exist. Schema parity and success/rollback tests run locally.
- PostgreSQL: `prisma/migrations/20261022130000_branch_group_purchase_policies/migration.sql`. This is a guarded conversion for the previous package-owned policy tables. It has not been executed on PostgreSQL. The existing worktree also contains an edited older policy migration and an earlier-dated precision migration referring to later-created columns; their application/checksum history must be reviewed before calling the entire PostgreSQL migration chain deploy-ready. Those existing files were not changed by this task.

No database reset, destructive db push, live migration, policy activation or Cloudflare deployment was performed. Existing applied migrations were not edited by this conversion.

## API contract

Use BRAND_OWNER or a BRANCH_MANAGER assigned to the requested branch for all four endpoints. Customer/staff requests and cross-branch managers receive 403. Missing branch/policy returns 404; invalid IDs or payloads return 400. Both policy updates preserve optimistic version comparison and increment the version. Audit logs retain the existing action names, with entityType BRANCH and entityId equal to branchId.

```http
GET /api/v1/branches/:branchId/group-purchase-refund-policy
PUT /api/v1/branches/:branchId/group-purchase-refund-policy
GET /api/v1/branches/:branchId/group-purchase-cancellation-policy
PUT /api/v1/branches/:branchId/group-purchase-cancellation-policy
```

The old `/packages/:packageId/refund-policy` and `/packages/:packageId/cancellation-policy` endpoints have been removed. Update the frontend to send branchId in the URL. Success responses keep the existing envelope and return the stored policy including id, branchId, version and timestamps. Payload validation is moved unchanged from the package policy handlers.

Example refund policy payload (elapsed hours since purchase):

```json
{
  "isEnabled": true,
  "refundAllowed": true,
  "refundTiers": [
    { "minimumHoursAfterPurchase": 0, "calculationType": "PERCENTAGE", "value": 100 },
    { "minimumHoursAfterPurchase": 24, "calculationType": "PERCENTAGE", "value": 50 },
    { "minimumHoursAfterPurchase": 48, "calculationType": "PERCENTAGE", "value": 0 }
  ],
  "allowPartiallyUsedRefund": false,
  "allowExpiredRefund": false,
  "requireNoActiveAppointments": true
}
```

Example cancellation policy payload:

```json
{
  "isEnabled": true,
  "cancellationAllowed": true,
  "minimumCancellationHours": 2,
  "restorationMinimumHours": 24,
  "lateCancellationOutcome": "FORFEITED"
}
```

This task changes ownership, management APIs and storage. It does not implement a new refund evaluator, entitlement accounting or a branch-selection rule for Buy Later checkout. Existing service cancellation/refund rules continue to apply; saving tiers alone does not activate new money-moving behavior.

## Files changed by this conversion

- Prisma: schema/branch.prisma, schema/package.prisma, schema/GroupPurchaseRefundPolicy.prisma and the new guarded PostgreSQL migration.
- Branch module: branch.route.ts and new branch-group-purchase-policy.service.ts, .controller.ts, .validation.ts and .interface.ts.
- Package module: package.service.ts, .controller.ts, .validation.ts, .interface.ts and .route.ts remove the former policy handlers/types/routes while preserving unrelated package functions.
- Cloudflare: new v11 migration, regenerated prisma/schema.prisma and runtime/model-metadata.json; runtime/database-fixture.mjs, runtime/migration-fixture.mjs and book-now.integration.test.mjs.
- Scripts: build-cloudflare.mjs, check-cloudflare-schema.mjs, test-cloudflare-migrations.mjs and the new read-only audit SQL.
- Documentation: this report and BOOK-NOW-STAGING.md.

## Rollout checks

Final local verification passed: Prisma format, validate and generate; TypeScript build/typecheck; full `npm run test:regression` (139 TAP tests, zero failed/skipped); Cloudflare generated-schema parity; real adapter checks; v11 upgrade/rollback guards; 71 group-purchase service assertions within the Worker integration test. The 19-test public API suite exercises both branch policy types, owner/manager writes, cross-branch read/write rejection and version increments. An initial preservation assertion compared SQLite column order rather than values; it was corrected and both focused migration tests and the full regression suite then passed.

Prisma format/validate/generate use `--config cloudflare/node-client.config.ts` to load the real split Node schema without requiring a live database connection. TypeScript checking, full regression, SQLite schema parity, immutable migration checks and branch API tests are the local gates. PostgreSQL execution and real staging data remain separate checks.

Before rollout, back up staging, run the read-only mapping audit, resolve any unmapped rows and confirm the target PackageBranch assignment. Deploy schema and API code together, with the same Durable Object singleton/class. Keep feature flags unchanged. After an authorized staging deploy, GET both branch policies and compare their IDs/settings/versions/timestamps with the pre-upgrade records; verify manager scope and both PUT endpoints. Do not reset or edit historical migrations if a guard/checksum fails.
