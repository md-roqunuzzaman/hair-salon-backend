# Subscription schema and SaaS pricing: Cloudflare v44

Prepared 2026-11-18 from the current `prisma/schema/subscription.prisma`, Brand inverse relation and `seedSaasPricing()` implementation. Staging deployment and seed execution are authorized by the user's request. Production and PostgreSQL are outside this task.

## Schema

`0044_subscription_pricing.sql` adds SubscriptionPlan, AddonFeature, BrandSubscription and BrandSubscriptionAddon, with the Prisma-defined unique indexes, lookup indexes and RESTRICT/CASCADE foreign keys. Decimal(12,2) values use integer minor units and INSERT/UPDATE precision triggers, consistent with the existing Cloudflare adapter. Status enum values are stored as TEXT. Migrations v1-v43 remain unchanged.

No historical tables are rebuilt. The migration does not assign Brand owners, create merchant subscriptions, change booking/payment data or insert pricing defaults. Branch.brandId remains nullable.

## Seed

`npm run seed:saas-pricing:cloudflare` is a read-only preflight. After v44 is deployed and initialized, `npm run seed:saas-pricing:cloudflare -- --apply` inserts only missing definitions into the fixed staging namespace/object. It checks namespace identity and migration checksums. Parameterized `ON CONFLICT(code) DO NOTHING` statements preserve all existing administrator prices, currencies, names, descriptions, activation flags, IDs and timestamps. Partial initialization is recoverable by rerunning.

| Definition | Code | Initial price HKD |
| --- | --- | ---: |
| Standard Plan | STANDARD | 500 |
| Branch Store | BRANCH_STORE | 100 |
| Group Buying | GROUP_BUYING | 150 |
| Hairstylist | HAIRSTYLIST | 80 |
| Wallet | WALLET | 120 |
| Comment / Review | REVIEWS | 50 |

Prices are stored in minor units (500 HKD = 50000). Worker tests compare this SQL seed with the application's actual `seedSaasPricing()` so defaults cannot drift unnoticed. The initial bootstrap remains unchanged; no new public bootstrap/seed endpoint was added. The PostgreSQL seed entry point was not run. No environment variables or secrets were changed.

## Verification

- Node and Cloudflare Prisma validation: passed.
- `npm run cloudflare:prepare:staging`: passed TypeScript, generation, full schema parity, migration checks and release verification.
- Existing populated database v43-to-v44 upgrade: all prior application rows preserved, injected-failure schema/data/ledger rollback, empty new tables, FK/unique/delete constraints, money guards, cascade behavior, unchanged historical snapshots and repeat startup passed.
- SQL pricing seed + Super Admin seed tests: **10 passed, 0 failed/skipped/cancelled**.
- Real Worker subscription tests, Branch/Brand relations, branch limit, no-show and exact production artifact: **9 passed, 0 failed/skipped/cancelled** (includes one nested test).
- Staging deployment dry-run: passed, **7887.35 KiB / gzip 2148.24 KiB**.
- Production artifact: **3,942,056 bytes**, v44; release verifier confirms 94 committed historical migration files unchanged and test fixture isolation.

The full unrelated regression aggregate was not rerun. This task makes schema and pricing defaults available; it does not add route permissions, subscription enrollment or billing behavior.

## Deployment outcome

Deployed successfully on 2026-11-18 to `hair-salon-backend-staging` at `https://hair-salon-backend-staging.icy-dew-e559.workers.dev`, Worker version `c5659fe6-98e7-4ec5-92cd-18b553a96b87`. Artifact SHA256: `a5d7319b01fc2e813b9a4c85607448e80b085be023a125529f98c6302a8360ab`. Public root returned HTTP 200.

Live preflight confirmed migration v44 with matching checksums and all six definitions missing. The apply command created exactly one STANDARD plan and five add-on features with the prices above, currency HKD and isActive true. A subsequent read-only run verified all six original IDs and prices, `created: false`, `wouldCreate: false`. No merchant subscriptions were created.

The read-only Branch verification confirmed 9 branches, zero NULL brandIds, zero invalid owners, matching v44 checksums and nullable Branch.brandId. Production, PostgreSQL, credentials and existing administrator accounts were not modified by this release. An older v43 runtime rejects the newer ledger: recovery must retain a v44-compatible Worker; do not blindly roll back the Worker to v43 against this object.

## Files

Migration: `cloudflare/migrations/0044_subscription_pricing.sql`. Generated schema/metadata and clients. Registration/checks: `scripts/build-cloudflare.mjs`, `scripts/check-cloudflare-schema.mjs`, `scripts/verify-unified-email-release.mjs`. Migration tests: `cloudflare/runtime/subscription-migration-fixture.mjs`, existing migration fixture/runner. Disposable Worker tests: `cloudflare/runtime/subscription-fixture.mjs`, existing integration entry, `cloudflare/subscription.integration.test.mjs`. Seed CLI/helper: `scripts/seed-cloudflare-saas-pricing.mjs`, `scripts/lib/cloudflare-saas-pricing.mjs`, `cloudflare/saas-pricing-seed.test.mjs`, package script. Source schema, pricing logic and application seed functions were preserved.
