# Existing staging: final deployment preflight

**Subsequent deployment completed:** see [the final staging deployment report](STAGING_FINAL_DEPLOYMENT_REPORT.md) for the active version, verified live migration ledger/data preservation, restored cron and 20 passing smoke tests. The preflight text below records the earlier state.

Verified 2026-10-22. Target: `hair-salon-backend-staging`, URL `https://hair-salon-backend-staging.icy-dew-e559.workers.dev`. This report does not authorize publication or restoration.

## Result

The captured staging data passed the candidate SQLite migrations locally. No additional v11 mappings are needed for that capture. The deployment candidate preserves all 148 existing routes and adds 15 policy routes. PostgreSQL is excluded from the Worker runtime and its migration ordering issue is independent of this SQLite upgrade. No PostgreSQL migration history was changed by this preflight.

**Recovery preparation update:** the subsequently approved local-only recovery task now has a tested encrypted-backup procedure, exact restoration checks and an emergency runbook: [local recovery report](STAGING_LOCAL_RECOVERY_REPORT.md). No live restore endpoint exists and native PITR has not been exercised. The current maintenance Worker cannot restore data. Agree on the documented recovery limitations and separately approve any live recovery implementation or final publication; a code rollback alone cannot undo v11/v12. Final application deployment has NOT been performed. The last confirmed remote state was maintenance, returning 503 on application routes; the local recovery task did not access Cloudflare to recheck it.

## Verified live capture

- Active maintenance version: `0ed1aca4-6182-4f34-906a-18df6f82e014`, 100% traffic; no cron schedules.
- Existing namespace: `2fdf4c973d96486bbf32c610f9a2cd89`, class `SalonDatabase`, binding `SALON_DB`.
- Existing object: `653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a`, name `salon-v1`. Independently matched against the control-plane object inventory before invoking maintenance reads.
- Read-only export: `2026-10-22T08:44:19.886Z`, 528,672 bytes, 42 SQL tables, one KV entry; two matching complete reads.
- Payload SHA-256: `8e25420ca9fb9c47280a9b554b42b6fb3821a451a00fe444a3ad087776585842`.
- Ignored, user-restricted local directory: `.maintenance-backups/staging-pre-upgrade/`. It contains the envelope, native bookmarks, receipt, complete mapping audit and a DPAPI-encrypted copy with verified decryption round trip. DPAPI depends on the current Windows user/profile keys; retain those keys or arrange an independently recoverable encrypted copy.
- Local SQLite physical integrity and foreign keys passed. Exact SQL/KV restore passed; real v10-to-v12 migration, repeated initialization and preservation of 6,544 existing cells passed. Counts preserved include 50 appointments, 42 payments, 2 wallets, 23 wallet transactions, 3 refund requests and 11 group purchases. Row-level customer/payment data was not printed.
- Live ledger versions 1–10 and all bundled checksums match exactly. Pending: 11 and 12.
- Four package-to-branch assignments audited. One legacy refund policy belongs to package `9ff78b23-f681-4007-a44c-ef4277decf17`, assigned to branch `f7318524-db7c-49cf-8bc4-bfc6ff5c6b97`. This matches v11's approved mapping. No legacy group cancellation policies, unresolved mappings or collisions.

No live database writes, migration execution, restore, real refund or final application publication were performed. Maintenance reads necessarily invoked the reviewed migration-free object constructor.

## Local validation

| Check | Result | Exit code |
| --- | --- | --- |
| `npm run test:regression` | 196 passed; 0 failed; 0 skipped | 0 |
| `node --test cloudflare/maintenance.test.mjs` | 3 passed; 0 failed | 0 |
| `npm run typecheck` | Passed | 0 |
| `npx prisma validate --schema prisma/schema` | Valid | 0 |
| `npm run test:cloudflare:migrations` | v12 upgrade, rollback guards, financial precision, FK/checksum checks passed | 0 |
| Cloudflare schema parity | Passed within full regression/build | 0 |
| Backup verifier and full mapping/ledger audit | Passed on actual captured data | 0 |
| `node scripts/inventory-routes.mjs` | 148 existing + 15 new, no collisions | 0 |
| `npm run cloudflare:check:staging` | Production build passed; staging dry-run 7,194.66 KiB / gzip 1,997.31 KiB; no publication | 0 |

Candidate `cloudflare/.build/worker.mjs` SHA-256: `8C119911409E0993CD7DCFB9C3C76F7442764F1335D4DC41CADB677EBA03FED3`. Final source-map inspection confirmed the SQLite runtime/client and no PostgreSQL/adapter-pg/Redis TCP dependencies. Both Postman JSON files parse, contain 40 request definitions, and have empty exported token placeholders. Wrangler's update check delayed dry-run startup; the command ultimately completed successfully with exit code 0. No dependency update was performed.

The first sandboxed maintenance-test invocation failed with `spawn EPERM`; the authorized unrestricted local rerun passed. A PowerShell backup digest check initially decoded UTF-8 as the system default encoding; the explicit UTF-8 check and independent Node verifier passed. A large SecureString encryption attempt failed; byte-based DPAPI encryption and decrypt round trip subsequently passed. These failures did not change remote data. Protective directory ACLs required elevated local file-writing context; no backup permissions were loosened.

## Exact operator sequence after the recovery gate is resolved

1. Recheck the maintenance deployment has 100% traffic, zero cron schedules and the exact existing namespace above. Ensure no other writers have resumed. If they have, capture and verify a new backup; do not rely on the old snapshot.
2. Reconfirm the working tree and candidate have not changed since validation. Existing dirty changes include the original implementation; do not reset or rewrite them.
3. With explicit final publication approval, pin the account and publish the application:

   ```powershell
   $env:CLOUDFLARE_ACCOUNT_ID = 'b57cd96d4a71d1b21f38db1b04f4dea8'
   npm run cloudflare:deploy:staging
   ```

   This rebuilds and deploys to the existing Worker. It restores minute cron and application handling, so object initialization and v11/v12 may run immediately. There is no separate D1 migration command: this is a SQLite-backed Durable Object, and the application constructor runs the immutable ledger-checked chain. Do not run PostgreSQL migrations, D1 commands, `__setup`, reset, namespace replacement or seeding.
4. Verify the application version is the sole active deployment and namespace/class/binding/URL remain unchanged:

   ```powershell
   npx wrangler deployments list --env staging
   npx wrangler versions view <new-version-id> --env staging
   ```

   Verify Worker settings and minute cron through the same control-plane checks used in this preflight. Review migration failures before allowing test writes. The normal app has no migration-ledger endpoint; do not invent one or claim ledger verification from a public HTTP success alone. An exact post-upgrade ledger export requires another approved maintenance window.
5. Test a public policy read, then authentication and ownership isolation; use only newly created synthetic test transactions for booking/cancellation/refund testing. Do not cancel/refund old staging customer records. Do not execute provider operations until deployed Stripe credentials are independently confirmed to be test mode. Control-plane secret names do not prove their values/mode.

## Recovery procedure requiring separate approval

Cloudflare documents per-object PITR for SQL and KV for the past 30 days using `getCurrentBookmark`, `onNextSessionRestoreBookmark` and object restart: [SQLite Durable Object PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api). Local Miniflare cannot certify native remote PITR.

If recovery is required, stop writes under migration-free maintenance first, preserve the failed state and external payment events, and verify account/namespace/object plus the private captured bookmark. A separately reviewed, strongly authenticated recovery implementation must call `onNextSessionRestoreBookmark` for that exact bookmark, securely retain its returned undo bookmark, and restart the object with `ctx.abort()`. Keep migration-free code active after restart so the failed migration is not immediately reapplied. Re-export to compare recovered SQL/KV/ledger with the trusted backup before reopening traffic. Restore reverses later legitimate financial changes too; reconcile provider events before reopening. No live restore endpoint or recovery mutation has been implemented or enabled. Cloudflare-assisted recovery is an alternative if no custom recovery implementation is approved.

## Postman after application publication

Import `docs/postman/merchant-cancellation-refund.postman_collection.json` and `docs/postman/merchant-cancellation-refund.staging.postman_environment.json`; select the staging environment. `baseUrl` is `https://hair-salon-backend-staging.icy-dew-e559.workers.dev/api/v1`. Supply fresh CUSTOMER and BRAND_OWNER tokens, valid test service/branch/package IDs and future Hong Kong slots. The existing branch/package environment values correspond to the audited mapping; do not assume existing purchases are safe test fixtures.

Read policy versions first; PUT requires the current `expectedVersion`. For fresh test bookings, preview before confirmation, reuse an idempotency key only for retries of the same operation, and inspect the resulting refund request. Positive refunds still require owner approval/processing. Use the [API guide](CANCELLATION_REFUND_POLICY_API.md) for all 15 endpoints and the request sequence. Initial Direct Booking cancellation remains intentionally guarded for QR/salon settlement; deployed Stripe acceptance and this product limitation remain outstanding.

## Changes in this preflight

- Added local-only `scripts/audit-maintenance-backup.mjs` to compare every ledger checksum, enumerate all package assignments and validate policy mappings/collisions. Its detailed output is saved only to the protected ignored directory.
- Updated `docs/STAGING_MAINTENANCE_RECOVERY.md` with actual capture and rehearsal results.
- Added this readiness report. Application routes, business logic, SQLite migrations and PostgreSQL migrations were not edited by this preflight.
