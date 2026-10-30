# PostgreSQL migration repair — 2026-10-30

Local SQL preparation only. No migration, reset, db push, migrate resolve, shadow replay, application deployment or business-data update was executed.

## Root cause and configuration

`prisma.config.ts` loads `prisma/schema`, uses `prisma/migrations`, and selects `DIRECT_URL` when configured, otherwise `DATABASE_URL`. This remains unchanged. No explicit shadow database URL is configured.

`20261030020000_preserve_existing_customer_access` previously queried `_prisma_migrations` in both a DO guard and its UPDATE predicate. Prisma's shadow-history replay cannot rely on the application's migration ledger being present there. PostgreSQL therefore raises 42P01; Prisma reports the migration application failure as P3018/P3006. The User table/schema migration itself is not the missing relation.

Prisma documents that migrate dev replays migration history in a temporary shadow database; production migrate deploy does not use that shadow database. See [Prisma shadow database documentation](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database).

## Read-only evidence before editing

All discoverable configured PostgreSQL connection sources were checked: `.env:DATABASE_URL` and `.env:DIRECT_URL`. Both returned the same relevant history:

- 75 local migrations before this fix; 72 successfully applied.
- All 72 applied migration checksums matched their current local files, allowing normal LF/CRLF equivalents.
- No successful, failed or rolled-back ledger entry existed for `20261030020000_preserve_existing_customer_access`, `20261030060000_policy_time_minutes`, or `20261030100000_refund_allocations`.
- The original `20261030014939_add_email_verification` was applied successfully and was not edited.
- Actual original `started_at`: **2026-10-30 01:49:40.572383+00**.
- Actual original `finished_at`: **2026-10-30 01:49:41.74788+00**.
- Its applied checksum was `46e0ebe379cfcb7d1e9334958eaf2c92e121762a2e55314182bab0c5729db4d4`.
- Five CUSTOMER records predate that start; zero current CUSTOMER records were created at/after it. No identities or credentials were printed.
- User.createdAt is timestamp without time zone; emailVerified remains NOT NULL with default false.
- GroupPurchase.validDaysSnapshot is absent in the configured database.

The existing date encoded in a migration directory was not used as the historical cutoff. No NOW(), deployment-time cutoff or invented verification timestamp was substituted.

These checks establish safety for the discoverable configured connections. They do not certify an unconfigured/unknown PostgreSQL environment. Verify its original migration cutoff and target-migration ledger before reusing this deployment-specific repair there. Cloudflare's SQLite ledger is separate from PostgreSQL's migration history.

## Files changed by this repair

1. `prisma/migrations/20261030020000_preserve_existing_customer_access/migration.sql`: replace the internal-ledger dependency with the verified fixed historical cutoff.
2. `prisma/migrations/20261030110000_group_purchase_valid_days_snapshot/migration.sql`: new additive nullable integer column, no default or historical backfill.
3. `cloudflare/README.md`: correct the obsolete description of the PostgreSQL grandfathering migration.
4. This report.

The existing user edits in `prisma/schema/group-purchase.prisma` and `src/app/module/group-purchase/group-purchase.service.ts` were preserved. No booking, authentication, payment, wallet or refund application logic was changed by this repair. The generated ignored Node Prisma client was refreshed for typechecking.

## SQL changes

The grandfathering transaction now contains:

```sql
BEGIN;
UPDATE "User" SET "emailVerified" = true
WHERE "role" = 'CUSTOMER' AND "emailVerified" = false
  AND "createdAt" < TIMESTAMP '2026-10-30 01:49:40.572383';
COMMIT;
```

The literal is the verified UTC start represented as a timestamp without time zone, matching the existing Prisma UTC column convention. Full microsecond cutoff precision is retained instead of rounding to the User column's millisecond precision. Comparing timestamps of the same type avoids session-timezone conversion. Customers at/after the cutoff are excluded. Existing verified state and emailVerifiedAt/updatedAt values are not rewritten. The schema's default false remains unchanged.

The snapshot migration contains:

```sql
BEGIN;
ALTER TABLE "GroupPurchase" ADD COLUMN "validDaysSnapshot" INTEGER;
COMMIT;
```

It matches `validDaysSnapshot Int?`. Existing purchases remain NULL; today's Package.validDays is not proof of an older purchase's original validity. No historic value was guessed.

## Review of other pending migrations

| Migration | Review outcome |
| --- | --- |
| `20261030060000_policy_time_minutes` | Retained unchanged. Explicit transaction, column renames and value multiplication preserve durations. Defaults become 720/120/1440 minutes as intended. JSON tier keys/values convert while saved historical snapshots remain untouched. Invalid/negative/overflow/conflicting values fail closed. Read-only checks of all five scalar guards passed on current data; the one current policy-tier row passed array/type/range/conflict checks. This script is a one-time versioned conversion and must not be reapplied manually. |
| `20261030100000_refund_allocations` | Retained unchanged. Additive RefundAllocation table, nullable wallet attribution columns, positive Decimal(10,2) amounts, status check, original PaymentProvider enum, unique request/payment/refund/idempotency identities and RESTRICT foreign keys match the current Prisma model. No financial backfill, balance update or record deletion. |
| `20261030110000_group_purchase_valid_days_snapshot` | New migration sorts after both pending schema updates. Nullable INTEGER matches the user's schema; no data transformation. |

The source verification migration sorts before grandfathering. That ordering supplies User.emailVerified before the UPDATE without requiring runtime inspection of Prisma's private ledger.

## Executed validation

| Check | Result |
| --- | --- |
| Configured ledger/checksum audit | Passed through both configured connection sources; read-only transactions |
| Historical literal vs actual started_at | Exact equality verified in PostgreSQL |
| `EXPLAIN` of the repaired UPDATE, without ANALYZE | Planned successfully; UPDATE was not executed |
| SELECT-only synthetic cutoff tests | 9 passed: before/exact/after cutoff, millisecond boundaries, non-CUSTOMER, already verified and future customers |
| Policy conversion data guards | Five scalar guards and one current JSON policy row passed |
| Schema-only Prisma diff | Generated exactly the nullable snapshot column; matches the new migration |
| Live datasource → Prisma schema diff | Read-only introspection passed; only expected pending policy/allocation/wallet/snapshot schema differences |
| `npx prisma validate --config prisma.config.ts` | Passed; exit 0 |
| Local Node Prisma generation with `cloudflare/node-client.config.ts` | Passed; exit 0; no DB connection required |
| `npm run typecheck` after generation | Passed; exit 0, no TypeScript errors |
| `npx prisma migrate status --config prisma.config.ts` | 76 migrations, 72 applied, four pending; exit 1 is expected for pending migrations |

The full shadow replay and migration application remain untested in this run because they create/change database state and require separate approval. Successful parsing/planning and schema checks are not represented as a completed PostgreSQL migration rehearsal.

The live schema-diff SQL was saved only as diagnostic output. It uses DROP/ADD for policy renames and does not preserve the custom data conversion, so it must not replace or be executed instead of the existing policy migration.

Evidence is ignored under `node_modules/.cloudflare-test/`: `prisma-history-audit.json`, `prisma-fix-readonly-result.json`, `prisma-fix-{validate,generate,typecheck,status,live-schema-diff}.log`, associated `.exit.txt` files, and `valid-days-snapshot.sql`. No credentials or customer email addresses are included in this report.

## Next commands and approval boundary

Read-only/local checks may be repeated:

```powershell
npx prisma validate --config prisma.config.ts
npx prisma generate --config prisma.config.ts
npm run typecheck
npx prisma migrate status --config prisma.config.ts
```

After a verified current backup, a separately approved rehearsal on a disposable PostgreSQL clone, and explicit approval for the intended target database, apply the four pending versioned migrations using:

```powershell
npx prisma migrate deploy --config prisma.config.ts
npx prisma migrate status --config prisma.config.ts
```

That deploy command has **not** been executed. The existing config directs it to DIRECT_URL when present; verify the intended database locally without posting its connection string. Use migrate dev only against an explicitly approved isolated development database. Do not use reset, db push, migrate resolve, or manually replay SQL to work around the issue.

The PostgreSQL repair above did not include a Worker rollout. A subsequent, separately requested local Cloudflare preparation adds SQLite v31 and generated snapshot metadata; see [the Cloudflare v31 candidate notes](../cloudflare/README.md#purchase-validity-snapshot--v31-local-candidate). No live PostgreSQL or Worker migration/deployment is implied by either local preparation.
