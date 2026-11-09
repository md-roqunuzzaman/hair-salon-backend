# Required purchase currency — Cloudflare v37 candidate

2026-11-07. Local preparation only. No deployment, live migration, data repair, secret change or delivery-setting change was performed.

The owner's PostgreSQL schema now requires `GroupPurchase.currency`, with the existing PostgreSQL candidate `20261106100703_group_purchase_currency_required`. Cloudflare uses its own SQLite Durable Object migrations, so that PostgreSQL SQL must not be applied to Cloudflare.

## SQLite equivalent

`cloudflare/migrations/0037_group_purchase_currency_required.sql` first checks for existing NULL purchase currencies. Any NULL rejects v37 atomically without advancing the migration ledger or changing financial rows. It does not assign HKD, add a currency default, or reconcile history.

Two INSERT/UPDATE triggers reject omitted or explicit NULL currency. This follows the existing v16 required-field strategy and preserves the referenced GroupPurchase table, foreign keys, indexes and money triggers. SQLite column metadata remains nullable; the schema checker verifies both exact enforcing trigger definitions before recognizing equivalent requiredness. Requiredness does not add a currency-code or nonempty-string SQL constraint; existing application validation remains responsible for supported denominations.

Build registration, generated Cloudflare Prisma schema, release verification and populated migration fixtures include v37. Versions 1–36 are unchanged. Reporting retains the mixed-currency guard and now rejects missing/empty stored denominations directly, consistent with required snapshots, instead of silently ignoring them. The existing report test initially reproduced that missing guard; the revised tests retain rejection even when legacy linked evidence exists, and permit an explicit reconciled snapshot.

Disposable tests cover rejection with historical NULLs, rollback after trigger creation, unchanged financial rows/table definition, missing/NULL inserts and updates, retained money/FK constraints, HKD/GBP/JPY snapshots and repeated initialization. Fixture-only reconciliation is not production migration behavior.

## Release conditions

Before a separately approved deployment, obtain a usable recovery point and freshly verify staging identity, applied checksums and `SELECT COUNT(*) FROM GroupPurchase WHERE currency IS NULL` equals zero. Also investigate empty/invalid denominations. The user's previous repair and yesterday's zero count do not replace a current preflight.

The current read-only staging preflight could not finish: the first metadata request returned 401; after refreshing the existing CLI authentication, direct and configured-proxy requests timed out connecting to Cloudflare. No SQL or mutation was submitted by those failed preflights. Current live counts/ledger are therefore **not verified by this task**. Do not deploy solely on local test results.

**Follow-up at 2026-11-07T03:23:41.760Z supersedes that connectivity blocker:** SELECT-only preflight succeeded against the verified existing staging namespace/singleton. There are **59 purchases, zero NULL currencies and zero empty currencies**. Applied migrations remain v1–36 and every checksum matches the local definitions; pending target is v37. Both queries report `rows_written=0`. Active Worker version remains `46fc91d8-51c1-4d92-af9d-aa4dd8a03d0c`. All verified source/configuration files and the exact Worker hash were unchanged before this documentation follow-up. No deployment or migration was executed. A usable current recovery point and v37-compatible recovery artifact still need to be retained before an approved rollout; this preflight does not establish backup/PITR availability. Recheck the point-in-time conditions if deployment is delayed.

After deployment, the existing migration runner applies pending v37 on Durable Object initialization. Retain a v37-compatible recovery Worker: an older v36-only Worker rejects a v37 ledger and is not a safe automatic rollback. Do not rebuild tables, alter old migration checksums or bypass the ledger to recover.

## Validation and artifact

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS, also repeated by final staging preparation. |
| `npx --no-install prisma validate --config prisma.config.ts` | PASS; validation only, no PostgreSQL migration. |
| International utility/report tests | 22/22 PASS (17 utility, five reporting); included in the aggregate below. |
| `npm run test:regression` | 464/464 PASS, zero failed/skipped/cancelled, exit 0. Original pipeline stages/order retained. |
| `npm run test:security` | 86/86 PASS. |
| `node --test cloudflare/security.integration.test.mjs` | 8/8 PASS with mocked providers/disposable storage; includes S4/S8 isolation, strict outer errors and signed Stripe webhook probes. |
| `npm run test:cloudflare:migrations` | PASS: populated upgrades, v37 NULL rejection/atomic rollback/financial invariance/requiredness/repeat checks and all existing checks. |
| `npm run cloudflare:prepare:staging` | PASS: generation, schema parity, migration checks and release isolation. |
| `npm run cloudflare:check:staging` | PASS, exit 0; upload dry-run only. 7700.61 KiB / gzip 2111.05 KiB. |
| `node --test cloudflare/tencent-production.integration.test.mjs` | 2/2 PASS against the exact final normal production artifact; fresh disposable setup, source-map freshness, fixture exclusion, HTTP/security/phone behavior, zero outbound calls and unchanged artifact bytes. |
| Release verifier / `git diff --check` | PASS; 92 committed historical migration files unchanged; test fixtures and diagnostic Tencent stub excluded. |
| Live staging preflight | PASS on follow-up: 59 purchases, zero NULL/empty currencies; all live v1–36 checksums match; zero rows written. Earlier authentication/timeouts are superseded. No migration/deployment submitted. |

Aggregate TAP breakdown: errors 39, auth/phone 45, SMTP five, database seven, booking 56, notifications 18, group refunds 23, financial proof 12, merchant-email Node 13/Worker 16, business-email Worker seven, Worker API 46, Book Now 27, policy Node 37/Worker 42, international utility/report 22/Worker 49. Composed distinct coverage is **560 TAP cases** (464 + 86 + 8 + 2); standalone reruns and migration/compiler checks are not added to that number. TAP counts include reported parent/subtest cases.

The initial report test run reproduced the missing-currency guard failure (3/4 passed); the guard and required-snapshot tests above address it. An initial aggregate run stopped at a Worker test's `Body has already been read` error. The unchanged complete Worker test passed in isolation, and the unchanged full pipeline rerun passed all 464 cases. No assertion was skipped/relaxed to resolve that transient failure. Sandbox `spawn EPERM` failures were rerun with local process permission; they were not represented as application passes.

Final Worker: **3,771,889 bytes**, SHA-256 **`dd89598270cba79a1f58d83d5101b525d5cbfc54402648b9a0c0b93975bb52bb`**, migration version 37. Existing staging delivery remains true, production false. No S4/S8 implementation, dependency definition/lockfile, financial formula, secret or deployment identity changed.

## Scoped changed files and integrity

Relative to this task's starting snapshot, ten existing files changed:

- `cloudflare/README.md`: current release conditions/report link.
- `cloudflare/prisma/schema.prisma`: regenerated required currency field.
- `scripts/build-cloudflare.mjs`: append v37.
- `scripts/check-cloudflare-schema.mjs`: apply/verify exact requiredness triggers before schema equivalence.
- `scripts/verify-unified-email-release.mjs`: v37 registration, no-backfill and required-field verification.
- `cloudflare/runtime/migration-fixture.mjs`, `scripts/test-cloudflare-migrations.mjs`: preserve earlier checks and add populated v37 coverage.
- `src/app/utils/report-currency.utils.ts`: fail closed on missing/empty required stored denominations.
- `cloudflare/international-report.test.mjs`: required-snapshot regression coverage.
- `cloudflare/tencent-production.integration.test.mjs`: remove stale v36 wording from the test title; assertions retained.

Two new files: `cloudflare/migrations/0037_group_purchase_currency_required.sql` and this report. Of **541** starting nonignored files, **531** are byte-identical; the other ten are the intentional changes listed above. Starting dirty Brand/GroupPurchase/Payment/currency-helper implementation, Node schema, PostgreSQL migration and `check-currency.ts` are preserved. The latter is a mutating maintenance script, not a safe read-only checker, and was never executed.

Git status and before/after hashes, commands/logs/exit codes are ignored under `node_modules/.cloudflare-test/schema-v37/`. No commit/push was made. Local success establishes a candidate, not a claim about current live data, external providers or production load. After a successful fresh read-only preflight and recovery review, the normal `npm run cloudflare:deploy:staging` remains a separately approved operation; it is not executed here.
