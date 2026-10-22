# Existing staging deployment completed

Verified 2026-10-22, 09:19 UTC. User explicitly approved final publication, expected v11/v12 migration execution, original cron restoration and non-destructive verification, acknowledging native PITR is untested and code rollback does not reverse SQLite migrations.

- Worker: `hair-salon-backend-staging`.
- URL: https://hair-salon-backend-staging.icy-dew-e559.workers.dev
- API base: https://hair-salon-backend-staging.icy-dew-e559.workers.dev/api/v1
- Final active version: `d5d98aa9-71cd-4b28-a9bf-d0973b2c2a09`, 100% traffic.
- Namespace preserved: `2fdf4c973d96486bbf32c610f9a2cd89`; binding `SALON_DB`; class `SalonDatabase`.
- Object preserved: `653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a`, name `salon-v1`.
- Original cron restored and control-plane verified: `* * * * *`.
- All original secret bindings preserved. No secrets changed during this deployment task.

No production deployment, new Worker/database, database reset, native restoration or automatic rollback was performed. PostgreSQL migration history and application business logic were not edited by this deployment task.

## Backup and unchanged-data gate

Before publication, the existing encrypted backup was successfully decrypted and rehearsed again with `scripts/Test-StagingRecovery.ps1`. Its original envelope, DPAPI copy and receipt remained unchanged. Pinned payload SHA-256: `8e25420ca9fb9c47280a9b554b42b6fb3821a451a00fe444a3ad087776585842`. The exact native recovery bookmark remains preserved in the protected receipt and pinned local verifier. The recovery limitations remain documented in [the local recovery report](STAGING_LOCAL_RECOVERY_REPORT.md).

Control-plane verification confirmed the expected maintenance version, 100% traffic, zero cron schedules, namespace and existing object. An authenticated read-only current export matched **all schema, table cells and KV entries** in the verified backup exactly: 42 tables and one KV entry. Only capture metadata/time/bookmarks were excluded from this data comparison. No fresh backup/rehearsal approval was needed because the data had not changed.

The first control-plane request encountered expired authentication (`10000 Authentication error`); Wrangler refreshed the existing OAuth login successfully, then the complete preflight passed. No publication had begun at that point.

## Migration verification and publication sequence

The exact previously validated production artifact was preserved throughout: `cloudflare/.build/worker.mjs`, SHA-256 `8C119911409E0993CD7DCFB9C3C76F7442764F1335D4DC41CADB677EBA03FED3`.

1. Dry-ran and published that artifact to the same existing staging Worker using an ignored temporary configuration with **cron disabled**. Initial application version: `03fa6829-1da4-4881-a123-fc18133dcf13`. A read-only root request returned HTTP 200 and initialized the approved migrations. Namespace and zero cron schedules were checked before that request.
2. Published the previously reviewed migration-free maintenance bundle briefly for exact read-only export verification. Verification-window version: `7f80245c-9282-46ce-a6d4-cdf3dd03a9dd`. Namespace, sole active version and disabled cron were rechecked before export. This planned verification window was not a failure rollback.
3. Captured the migrated database and checked the actual live ledger: versions **1–12**, with every checksum matching the immutable bundled manifest. v11 and v12 completed successfully:

   | Version | SHA-256 |
   | --- | --- |
   | 11 | `10b106326b929fc4c8b91d05b213b768c56705720fd3ff7526a32858f63b08d2` |
   | 12 | `a54b947b76c54fed9b0d3a8fbfebeab26f9efa04fdf482f1477533f558218392` |

4. Verified every original table retained its row count and all 6,544 compared original non-ledger cells were preserved, allowing only the explicitly reviewed historical migration transformations. KV was unchanged. This includes appointments, all financial records, paid/bonus Wallet balances and ledger entries, refunds, Group Purchase quantity/usage/snapshots and policy records. The legacy refund policy received the approved package-to-branch conversion. No extra mappings were needed.
5. Restored the migrated capture into another disposable **local** Miniflare database. Its complete ledger, repeated migration execution, data restoration and candidate schema fingerprint comparison passed. This verifies the captured live migrated schema against a clean full-chain reference. Independent Prisma/SQLite parity had already passed in preflight.
6. Re-published the same validated application artifact using the original staging configuration and restored the original cron. Final version: `d5d98aa9-71cd-4b28-a9bf-d0973b2c2a09`. Rechecked 100% traffic, exact namespace/class/object, original secrets and minute cron through the control plane.

Every deployment/dry-run and capture comparison above exited 0. No migration/data verification failed. Data equality was measured before normal traffic/cron reopened; subsequent legitimate application or cron work can change operational state.

## Non-destructive smoke tests

`node scripts/smoke-staging-policies.mjs`: **20 passed, 0 failed, exit 0** against the final application version.

- Existing routes: root and public package detail returned 200; appointment, Wallet and refund-request lists correctly required authentication (401).
- All 15 new method/path registrations were probed: the configured public group refund policy returned 200; unconfigured service/group-cancellation policies returned the expected `POLICY_NOT_CONFIGURED` 404; all 12 protected method/path combinations rejected unauthenticated requests with 401.
- No credentials were supplied and no protected controller was executed by the PUT/POST probes. No booking, policy update, real payment/refund, seeding or destructive test was requested.
- Local route inventory reconfirmed all **148 existing routes + 15 new routes**, without method/path collisions. This is registration/contract preservation, not a claim that every old route was exercised live.

Successful authenticated customer/owner workflows and deployed Stripe test-mode acceptance remain for Postman testing. This task did not determine the deployed Stripe key mode or contact Stripe directly. The initial Direct Booking cancellation guard remains unchanged.

## Evidence and commands

Private evidence is in the ignored, Windows-user-restricted `.maintenance-backups/staging-pre-upgrade/` directory:

- `pre-deploy-current-envelope.json`, `before-deployment-comparison.json`.
- `post-migration-envelope.json`, `after-deployment-comparison.json`.
- `final-deployment-receipt.json`, `final-smoke-tests.json`.
- Original `staging-envelope.json`, `staging-envelope.dpapi`, `receipt.json` and local recovery-run reports.

These files contain sensitive backups; do not commit, print or attach them. Local comparison scripts use exclusive report creation and will refuse overwriting existing evidence.

The final publication command was:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'b57cd96d4a71d1b21f38db1b04f4dea8'
npx wrangler deploy --env staging
```

Do not repeat deployment merely to verify this report. Operational checks can use read-only control-plane version/settings queries. A new live ledger export requires an explicitly authorized inspection window; the normal application exposes no maintenance/export/restore endpoint.

Import [the Postman collection](postman/merchant-cancellation-refund.postman_collection.json) and [staging environment](postman/merchant-cancellation-refund.staging.postman_environment.json), select staging, and supply CUSTOMER/BRAND_OWNER tokens. Follow [the API testing guide](CANCELLATION_REFUND_POLICY_API.md). Use synthetic transactions and independently verify Stripe test mode before payment/refund acceptance testing; do not use old customer financial records as test fixtures.

Deployment-task additions: `scripts/compare-staging-capture.mjs` (local capture comparison), `scripts/smoke-staging-policies.mjs` (explicitly limited staging probes), this report, and links from earlier readiness reports. The temporary cron-disabled configuration is ignored under `node_modules/.cloudflare-test/`; the original `wrangler.jsonc` remains unchanged.
