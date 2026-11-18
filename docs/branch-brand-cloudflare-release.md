# Nullable Branch brand ownership: Cloudflare staging candidate

**Superseded preparation workflow:** the later [full-schema v43 update](latest-schema-cloudflare-release.md) includes Brand owner relations and SUPER_ADMIN. The temporary Branch-only snapshot helpers have been retired; use the normal Cloudflare build/deploy commands below. The v42 SQL and its backfill behavior remain unchanged. Live values described below are the historical read-only preflight, not proof that a deployment has occurred.

Prepared on 2026-11-18. Scope was explicitly narrowed to **Branch.brandId only** while the owner continues other schema edits. The owner chose to deploy manually. **No deployment, live backfill, PostgreSQL write or secret change was performed.**

## Prepared change

SQLite v42 (`0042_branch_brand_relation.sql`) adds nullable `Branch.brandId`, its non-unique index, and a Brand foreign key with delete RESTRICT / update CASCADE. It does not rebuild Branch or change any existing field, timestamp or child relation. `Brand.branches` is included in the generated client/adapter metadata.

The migration backfills NULL branch ownership only when exactly one Brand exists. A database with no Brand or multiple Brands retains NULLs and requires an explicit ownership mapping. Existing assignments are never overwritten, and no required-field constraint or automatic default is introduced. The migration SQL and ledger entry run together in the existing `storage.transactionSync()` mechanism.

## Read-only live preflight

Only Cloudflare staging is the requested backfill target:

- Worker: `hair-salon-backend-staging`.
- Namespace: `hair-salon-backend-staging_SalonDatabase` (`2fdf4c973d96486bbf32c610f9a2cd89`).
- Object: `salon-v1` (`653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a`).
- One Brand: **ABC Hair Salon**, ID `38d9bae7-7262-4e03-b8a5-f3e9bd7cdce5`.
- Nine Branches; the live Branch table has no `brandId` column yet. Applied ledger ends at v41.
- Final read-only verification confirms every applied v1-v41 checksum matches the prepared artifact.

Consequently v42 will fill the nine existing Branch rows with that Brand if this single-brand state still holds at deployment. Live backfill is pending the owner's deployment. Earlier PostgreSQL discovery was SELECT-only; PostgreSQL is excluded from further work and was not modified.

## Local checks

- Scoped Node and SQLite Prisma schema validation/client generation and TypeScript: passed.
- Generated SQLite schema parity against the complete v1-v42 migration chain: passed.
- Existing historical migration checks plus populated v42 preservation/rollback, index, nullable field, foreign-key, delete restriction, update cascade and repeat initialization: passed.
- Additional disposable databases cover empty, zero-brand, single-brand and multi-brand upgrades. Singleton backfill preserves all unrelated fields/rows; ambiguous ownership remains NULL. The injected post-backfill failure rolls back schema, rows, index and ledger.
- Real Worker relation, branch-limit, no-show and exact production-artifact checks: **6 TAP entries passed; zero failed/skipped/cancelled**. The real Prisma adapter reads nullable relations and inverse Brand.branches correctly; financial rows remain unchanged.
- Release verifier: v42, 94 unchanged historical migration files and production fixture isolation passed.
- Staging upload dry-run: **7850.70 KiB / gzip 2141.94 KiB**. Production Worker: **3,905,108 bytes**.

The full unrelated API/security aggregate was not rerun for this additive schema change.

## Current preparation workflow

The initial Branch-only candidate used an ignored snapshot while Brand.owner was incomplete. The owner subsequently requested the latest complete schema, which now validates. Normal preparation again reads `prisma/schema`, including nullable Brand.ownerId, User.ownedBrands and SUPER_ADMIN:

```powershell
npm run cloudflare:prepare:staging
npm run cloudflare:check:staging
```

When ready to publish the prepared artifact yourself:

```powershell
npm run cloudflare:deploy:staging
```

This publishes the current application bundle and full schema. Pending v42 branch ownership/backfill and v43 nullable Brand owner migrations apply on next object initialization. Preserve the existing namespace/class/object identity and retain a usable recovery point plus a v43-compatible recovery artifact. An older Worker rejects the newer migration ledger.

## Verify backfill before making brandId required

```powershell
node scripts/backfill-cloudflare-branch-brand.mjs
```

Default mode performs only SELECT/PRAGMA requests to the fixed staging namespace/object. It checks the live migration ledger against the prepared artifact and reports branch/null/orphan counts. Before v42 is applied it returns a clear schema-not-ready result without writes. After rollout, expect v42, `branchCount: 9`, `nullAfter: 0`, `invalidOwners: 0`, `brandIdNullable: true` (branch count may change if users create branches).

If NULLs were created afterward and exactly one Brand remains, the explicit, idempotent NULL-only backfill command is:

```powershell
node scripts/backfill-cloudflare-branch-brand.mjs --apply
```

It requires the prepared migration to be applied, refuses ambiguous ownership, preserves non-null ownership and checks other Branch fields. No schema/ledger changes or deployments occur in this helper. Its write mode was not run against live staging in this task.

**Do not make the field required until the live verification reports zero NULLs/orphans.** Current `createBranch` still omits brandId, so new branches can create NULLs in this nullable phase; update that write path and recheck/backfill immediately before the separate required-field migration. This task deliberately leaves the field nullable and does not change branch creation business logic.

## Changed files for this task

- `cloudflare/migrations/0042_branch_brand_relation.sql` and generated `cloudflare/prisma/schema.prisma` / `runtime/model-metadata.json`.
- Build/schema/release verification scripts, plus optional source-directory support in `prepare-cloudflare.mjs`.
- `scripts/backfill-cloudflare-branch-brand.mjs`; the initial temporary snapshot/preparation helpers were retired by the v43 follow-up.
- Migration fixture/runner, the new branch-brand migration/Worker fixtures and `branch-brand.integration.test.mjs`.
- This report. The owner's Prisma source/migration candidates, no-show edits and branch-limit edits were preserved.
