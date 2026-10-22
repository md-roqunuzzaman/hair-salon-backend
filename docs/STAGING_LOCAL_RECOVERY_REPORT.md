# Staging recovery: local readiness report

Verified locally on 2026-10-22. This task performed **no remote operation**, deployment, secret change, Cloudflare storage write or native restoration. It created no live restore endpoint. Application business logic and PostgreSQL/SQLite migration files were not edited.

## Result

The existing staging backup can be decrypted by its Windows owner, restored exactly into disposable local SQLite Durable Object storage, and upgraded from v10 to v12 with candidate-compatible schema. Local recovery preparation is complete. Native Cloudflare PITR and a future live recovery implementation are **not** certified by this local rehearsal. The tooling intentionally cannot restore a live object.

Target identity recorded in the backup:

- Worker: `hair-salon-backend-staging` (existing URL unchanged).
- Namespace: `2fdf4c973d96486bbf32c610f9a2cd89`; class `SalonDatabase`; object name `salon-v1`.
- Object ID: `653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a`.
- Capture: `2026-10-22T08:44:19.886Z`.
- Pinned payload SHA-256: `8e25420ca9fb9c47280a9b554b42b6fb3821a451a00fe444a3ad087776585842`.
- Exact recovery bookmark remains in the protected receipt and is pinned in the local verifier. It is recovery metadata, not a maintenance authentication credential.

## Commands: local only

Run from `C:\Job\hair-salon-backend` as the same Windows user that encrypted the backup, with installed dependencies and generated `cloudflare/.build/migrations.mjs`:

```powershell
node --test cloudflare/local-recovery.test.mjs
node --test cloudflare/maintenance.test.mjs
node scripts/check-cloudflare-schema.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-StagingRecovery.ps1
```

The `ExecutionPolicy Bypass` switch applies only to that child PowerShell process; it does not change machine/user policy. The first invocation without it was blocked by this machine's unsigned-script policy (exit 1); the reviewed process-only invocation passed (exit 0). If organization policy forbids overrides, use the organization's signing/approval process instead.

The wrapper accepts **no arguments**. It reads the fixed ignored `.maintenance-backups/staging-pre-upgrade/` directory, verifies the encrypted and plaintext envelope bytes match, and decrypts only into a new restricted subdirectory. The Node verifier independently checks the pinned payload hash, namespace, object ID and recorded bookmarks before running SQL. Hashes of the original envelope, encrypted backup and receipt are checked again in `finally`; originals are never overwritten. The temporary plaintext file is removed in `finally`. The original protected plaintext backup remains unchanged.

The local runner builds only `cloudflare/maintenance/local-recovery.mjs`, supplies no Cloudflare credentials, reads no Wrangler configuration and has no remote namespace binding or persistent storage setting. Miniflare binds to `127.0.0.1`, blocks outbound fetch, and creates disposable local objects named `disposable-restore` and `empty-reference`. Its synthetic `.invalid` dispatch URL does not contact DNS or Cloudflare. A local guard must be present before any storage work. Recovery modules are absent from both application and maintenance deployment bundles.

## Restoration checks

The encrypted backup itself was used as input, not a newly exported copy. All 42 SQL tables were restored with exact schema, columns, typed cells and row order. Every restored table's SHA-256 was independently compared to its source table; SQL/KV equality checks include blobs, exact integers and session data. Python SQLite integrity and foreign-key checks passed before Miniflare restoration. The complete original v10 ledger and checksums matched the immutable migration manifest. The subsequent v12 ledger was complete, the upgrade was repeatable, and 6,544 original cells were preserved subject to the previously reviewed migration transformations.

| Records | Restored rows | Verification |
| --- | --- | --- |
| Appointments | 50 | Every column and row exact |
| Payments | 42 | Amounts, state and provider identifiers exact |
| Wallets | 2 | Paid/bonus balances and all other cells exact |
| Wallet transactions | 23 | Full ledger rows exact |
| Wallet top-ups | 8 | Full rows exact |
| Refunds | 5 | Full rows exact |
| Refund requests | 3 | Amounts, states, references and all other cells exact |
| Group purchases | 11 | Quantity, usage/entitlement, financial and snapshot fields exact |
| Package-to-branch assignments | 4 | Full rows exact |
| Group refund policies | 1 | Exact restore, followed by approved v11 branch conversion |
| Group cancellation policies | 0 | Empty state preserved; no policy invented |
| Service cancellation policies | 0 | Empty state preserved; no policy invented |
| Stripe webhook events | 16 | Full rows exact |
| Sessions | 97 | Full rows exact; no expiry cleanup executed |
| KV entries | 1 | Exact tagged-value restoration |

All remaining tables were also compared exactly; verification was not limited to these categories. Digests prove fidelity of the captured records, not correctness of historical business transactions. No real provider payment/refund was requested. Existing missing snapshots were preserved; no policy was retroactively attached. Group entitlements are checked through all GroupPurchase and Appointment cells, not through a nonexistent redemption table.

After migration, a separate empty local object ran the complete migration chain. The restored/upgraded object's application schema fingerprint matched that reference: columns, defaults, indexes and foreign keys. The original `_Sessions` and `_Migrations` runtime tables are checked separately and excluded from this application-schema fingerprint. The existing independent Prisma-to-SQLite structural parity check also passed. Exact pre-upgrade SQL schema restoration includes trigger definitions; this structural comparison does not independently prove every trigger's behavior.

| Local command | Result | Exit code |
| --- | --- | --- |
| `node --test cloudflare/local-recovery.test.mjs` | 3 passed, 0 failed, 0 skipped | 0 |
| `node --test cloudflare/maintenance.test.mjs` | 3 passed, 0 failed, 0 skipped | 0 |
| `node scripts/check-cloudflare-schema.mjs` | Schema parity passed | 0 |
| Encrypted-backup PowerShell rehearsal | 42 tables exact; v10 restore; v12 upgrade; schema match | 0 |

Negative tests cover remote/UNC paths, wrong hash/object/namespace/bookmark, nonempty restoration targets, ledger checksum mismatch, candidate schema mismatch and absent local guard. Tests also confirm recovery code is absent from deployment bundles. Error responses omit SQL and financial/customer values.

The last full application regression was 196 passed, 0 failed, 0 skipped, exit 0, during the preceding deployment preflight. It was not rerun for these local-only additions. No application code changed. Prior Worker build/dry-run results are documented in [the final deployment preflight](STAGING_FINAL_DEPLOYMENT_READINESS.md).

Protected run directories contain `recovery-report.json` with per-table counts/digests. No row values are printed. Find the latest successful report with:

```powershell
Get-ChildItem .maintenance-backups/staging-pre-upgrade/recovery-run-*/recovery-report.json |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 FullName
```

## Emergency recovery sequence: future approval required

These steps are an operator procedure, **not executable live tooling**. Do not use the local importer against Cloudflare or deploy the local test harness.

1. Obtain explicit approval for each remote action: read-only control-plane/maintenance inspection, any temporary recovery code publication, exact object/bookmark restoration, object restart, and eventual application reopening. Final backend publication requires separate approval too. This local-task approval covers none of them.
2. Under approved write-free maintenance, verify the existing account, namespace, class, object ID and 100% active version, disable/drain application writers and cron, and account for webhook retries. Do not assume the remote state still equals the last recorded maintenance state; this task did not recheck it.
3. Preserve the current failed state, deployment artifacts and provider event history under a separately approved read/export operation. Confirm the selected recovery bookmark belongs to this exact object, is within Cloudflare's retention window and corresponds to the intended pre-upgrade capture. Verify the encrypted backup locally again with the commands above.
4. Have an operator review and separately approve a minimal temporary native-PITR implementation (or arrange Cloudflare-assisted recovery). It must run under a migration-free constructor, authenticate strongly, pin the namespace/object/bookmark and be disabled by default. No such endpoint is included here. Do not add the method to the normal application Worker: its constructor could apply migrations before restoration.
5. The approved native operation calls `ctx.storage.onNextSessionRestoreBookmark(recordedBookmark)` for the pinned object. Securely retain the returned **undo bookmark before restarting**. Then call `ctx.abort()` to restart; expect the triggering request to terminate. Keep migration-free code active. Do not retry a restoration blindly after a disconnected response; inspect approved metadata/state first.
6. After restart, use a separately approved read-only export to compare SQL/KV, the v10 migration ledger, policy records, appointments, payment/refund records and Wallet/entitlement data against this trusted backup. If restoration does not match, keep maintenance active and investigate; do not reopen automatically.
7. Reconcile every external Stripe/payment/refund/webhook operation after the capture. A database restore does not reverse provider-side money movement. Choose and validate a corrected deployment candidate locally. Only publish/reopen with explicit approval, preserving Worker/namespace/object identity. Do not immediately run the failed migrations again.

Cloudflare documents native per-object SQL+KV PITR within 30 days, `onNextSessionRestoreBookmark`, its returned undo bookmark and restart via `ctx.abort()`: [official PITR reference](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api). This local task did not access that API. A code rollback restores code, not data.

## Limitations

- Native PITR is not supported locally and was not executed remotely. No live restore endpoint exists. Future live restoration requires a separately reviewed/approved implementation or Cloudflare assistance. Local success must not be described as remote PITR certification.
- DPAPI CurrentUser decryption depends on the original Windows profile and keys. Preserve those or arrange an approved encrypted off-device copy with separately recoverable keys. No off-device transfer was performed.
- Temporary plaintext deletion is best effort on crash/power loss and is not secure erasure. Run on an encrypted volume, protect Windows profile/backups and inspect the restricted run directory after an interrupted process. Do not upload real backups into bug reports or Postman.
- The local logical backup includes accessible SQL and KV. It does not claim to capture alarms, external queues/R2, provider state, configuration or secrets. No live logical import is implemented.
- Pins intentionally accept this exact capture only. A fresh backup requires independently verified identity/bookmark/hash and a reviewed local pin update. Changed hashes must not be accepted just to make a rehearsal pass.
- All remote actions and final deployment remain stopped pending separate approval. The last confirmed remote state was maintenance; no current remote-state claim is made by these local tests.

## Files changed by this local task

- Added `scripts/Test-StagingRecovery.ps1` (DPAPI wrapper, source-hash preservation and cleanup).
- Added `scripts/rehearse-staging-recovery.mjs` (pinned local verifier and disposable orchestration).
- Added `cloudflare/maintenance/local-recovery.mjs` (local-only restore/schema comparison harness).
- Added `cloudflare/local-recovery.test.mjs` (positive and fail-closed tests).
- Exported the existing `verifyPreservation` helper from `cloudflare/maintenance/local-rehearsal.mjs`; its behavior is unchanged.
- Added this report and updated the existing readiness/runbook links. Original backup artifacts and all migration/application files are preserved.
