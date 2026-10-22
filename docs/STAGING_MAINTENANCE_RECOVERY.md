# Staging maintenance/export review

Status (2026-10-22): temporary maintenance publication and token upload were approved and completed. Control-plane verification at 08:40 UTC confirmed version `0ed1aca4-6182-4f34-906a-18df6f82e014` at 100% traffic, existing namespace `2fdf4c973d96486bbf32c610f9a2cd89`, class `SalonDatabase`, zero cron schedules, and all 21 prior secret bindings plus the maintenance token. Application requests receive 503 by design. Subsequently approved read-only inspection/export completed at 08:44 UTC, after rechecking the active version and independently listing the existing object through the control plane. No live migration, restoration or final application publication was performed. Final application publication and any restoration still require separate approval. Target remains `hair-salon-backend-staging`, existing URL, `SALON_DB` / `SalonDatabase`, and `salon-v1`. PostgreSQL and existing SQLite migration files are unchanged by this maintenance work.

The previous application version was `5238b4fb-7fce-4ba5-aaae-4fcb62498752`; the secret upload produced intermediate version `ca7e0a3a-9291-4e63-a9d9-53a0abee95fa`. Local ignored release artifacts and verification metadata are under `.maintenance-backups/release-baseline/`. The complete source artifact is `worker-complete.multipart`, SHA-256 `AFC6BE61A2B236081DE99AE07B21711F64BECA14081EFF072228D64BAD5FBDFE`; `worker-content.multipart` is incomplete and must not be used. These are release artifacts, not a database backup. The maintenance token is stored locally using Windows DPAPI in ignored `.cloudflare-secrets.maintenance-token.json`.

## Files and access model

`wrangler.staging-maintenance.jsonc` is a standalone configuration targeting the **existing** staging Worker, pinned to account `b57cd96d4a71d1b21f38db1b04f4dea8` from the earlier read-only account check. It preserves its SQLite class migration declaration, disables cron and disables observability for the temporary implementation. Check live namespace/binding identity and actual routes/settings before any publication: this local file cannot prove the deployed namespace identity or preserve dashboard-only settings automatically. Do not add a new namespace, class rename/transfer, external `script_name`, or custom domain.

The maintenance constructor assigns `ctx` and `env` only. It imports no Express application, migrations, session manager, database adapter, seeding or payment services. All normal requests receive 503; scheduled handlers do nothing. There is no restore operation, arbitrary SQL, local-import route, or test fixture in this deployment bundle.

Maintenance GET operations require `Authorization: Bearer <MAINTENANCE_TOKEN>`. The token must be 64–128 lowercase hexadecimal characters; generate 32 random bytes or more. Comparison uses SHA-256 and constant-time digest comparison. No request/body logging is implemented. Responses disable caching. Do not store the token in the repository, Postman exports, shell history or transcripts. Inject it through a private deployment session or secret manager.

- `/__maintenance/target`: computes the object's ID from its name without obtaining a stub or invoking the object. Verify that ID and namespace against existing control-plane records before continuing.
- `/__maintenance/bookmark`: reads native recovery bookmark. Requires `X-Maintenance-Object-Id` matching the exact expected object ID.
- `/__maintenance/export`: requires the same pinned ID. Reads SQL schema and all application tables (including `_Migrations` and `_Sessions`) and enumerates accessible KV entries. No storage writes occur. It records before/after native bookmarks and requires two matching complete SQL/KV reads. This consistency argument requires the reviewed write-free maintenance version to be the sole active implementation and in-flight application writes to have drained. A full 100% deployment and controls on other callers are required.

Integer SQL cells are exported as exact decimal strings, independent of JavaScript safe-number limits. Blobs and KV types are tagged. Cycles, unsupported types, virtual/autoincrement schemas and unsafe numeric values fail closed. The one-shot response limit is 16 MiB; capture can also exhaust runtime memory/CPU before reaching that limit. No partial backup is valid. Large or unsupported datasets require a separately reviewed export extension; do not weaken checks.

The envelope contains `payload` as an exact JSON string and its SHA-256. The digest detects corruption, **not authenticity**; retain its digest separately in trusted records and protect the export with an encrypted disk and restricted access. Backups contain personal data, password hashes, sessions and financial history. Never commit them. `.maintenance-backups/` is ignored. Temporary local synthetic backups are under ignored `node_modules/.cloudflare-test/`.

## Local verification (authorized)

```powershell
npm run cloudflare:build
node --test cloudflare/maintenance.test.mjs
npm run typecheck
node scripts/inventory-routes.mjs
npm run test:cloudflare:migrations
npx wrangler deploy --config wrangler.staging-maintenance.jsonc --dry-run
npx wrangler deploy --env staging --dry-run
```

These commands use local disposable databases; `--dry-run` does not publish. Python 3 with sqlite3 is required for physical integrity checking. Local bookmark behavior is not evidence that remote PITR is recoverable.

## Approval gate A: maintenance publication (COMPLETED)

Record the active version, exact namespace, settings, existing routes, secret **names**, and minute cron. Preserve the previous release artifact. Coordinate a downtime window, stop application writers, and account for webhook retries, delayed expiry/reminders and any external callers. Existing requests may finish during deployment; verify they have drained before exporting. Rolling back code alone does not restore data.

The following publication commands are recorded for reference; do not repeat the completed deployment:

```powershell
npx wrangler deployments list --env staging
npx wrangler versions view <recorded-active-version> --env staging
npx wrangler secret list --env staging
npx wrangler secret put MAINTENANCE_TOKEN --config wrangler.staging-maintenance.jsonc
npx wrangler deploy --config wrangler.staging-maintenance.jsonc
npx wrangler deployments list --config wrangler.staging-maintenance.jsonc
```

Secret upload itself is a remote change and may create a new Worker version. Approval covers it explicitly. Verify the maintenance version has 100% traffic, no cron work, no application requests still executing and the **same existing namespace**. Do not perform a gradual deployment with the application and maintenance versions both active.

## Approval gate B: live read/export (COMPLETED)

Captured object `653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a` at `2026-10-22T08:44:19.886Z`. Backup payload SHA-256: `8e25420ca9fb9c47280a9b554b42b6fb3821a451a00fe444a3ad087776585842`. Export size: 528,672 bytes, 42 SQL tables, one KV entry, two matching complete reads. Bookmark before/export matched. Keep the exact bookmarks in private `receipt.json`; they are not reproduced here.

Files are in ignored `.maintenance-backups/staging-pre-upgrade/`, restricted to the current Windows user. `staging-envelope.dpapi` is a Windows CurrentUser DPAPI-encrypted copy with a verified byte-for-byte decrypt round trip. Keep the Windows profile/key material recoverable; this encrypted file alone is not an independently portable backup. The plaintext source remains in the restricted directory for local verification. Do not commit or attach these files.

The local verifier passed SHA-256, Python in-memory SQLite integrity/FK checks, exact SQL/KV restore, v10-to-v12 migration, repeated initialization and preservation of 6,544 old cells. This is a logical restore rehearsal, not a live PITR test. The ledger is an exact checksum-matching prefix through v10; only v11 and v12 are pending. All four PackageBranch assignments were enumerated. One legacy group refund policy matches the approved package-to-branch mapping; no group cancellation policy exists. Zero unresolved mappings or branch collisions. Private full audit: `mapping-ledger-audit.json`. Reproduce locally:

```powershell
node scripts/verify-maintenance-backup.mjs .maintenance-backups/staging-pre-upgrade/staging-envelope.json
node scripts/audit-maintenance-backup.mjs .maintenance-backups/staging-pre-upgrade/staging-envelope.json .maintenance-backups/staging-pre-upgrade/mapping-ledger-audit.json
```

The following reference commands assume the token is already supplied securely in the process environment. Do not repeat the completed export or overwrite its artifacts. The API URL must be confirmed against the actual staging deployment.

```powershell
$maintenanceUrl = 'https://hair-salon-backend-staging.icy-dew-e559.workers.dev'
$maintenanceHeaders = @{ Authorization = "Bearer $env:ABC_MAINTENANCE_TOKEN" }
$target = Invoke-RestMethod -Method Get -Uri "$maintenanceUrl/__maintenance/target" -Headers $maintenanceHeaders
# Compare $target.identity with the expected existing object. Stop on mismatch.
$maintenanceHeaders['X-Maintenance-Object-Id'] = '<independently verified existing object ID>'
$bookmark = Invoke-RestMethod -Method Get -Uri "$maintenanceUrl/__maintenance/bookmark" -Headers $maintenanceHeaders
# Use a protected encrypted directory. Keep the bookmark and account/namespace/object IDs in trusted records.
New-Item -ItemType Directory -Path .maintenance-backups -Force | Out-Null
Invoke-WebRequest -Method Get -Uri "$maintenanceUrl/__maintenance/export" -Headers $maintenanceHeaders -OutFile .maintenance-backups/staging-envelope.json
node scripts/verify-maintenance-backup.mjs .maintenance-backups/staging-envelope.json
```

Do not treat an HTTP error body, failed digest, truncated export or failed verifier as a usable backup. Do not expose the envelope in terminal output. The verifier accepts only a local file, checks its digest and format, reconstructs SQLite in Python `:memory:` and runs physical integrity/foreign-key checks. It then restores SQL and KV into disposable **local** Miniflare storage, compares restored values/schema with the backup, rehearses migrations and repeated initialization, and checks preservation of old cells and KV entries. It does not invoke Cloudflare or restore live storage. Backups are executable SQL input to an isolated local database: use only trusted exports.

Rehearsal deliberately stops on unrecognized value changes, schema conflicts, unmapped legacy policies and checksum mismatch. Expected conversions currently recognized are Direct Booking enum rename, package-to-branch mapping and late-cancellation boolean-to-outcome conversion. It does not certify future migrations. Standard schema parity tests must also pass; actual financial/business acceptance still requires review.

## Ledger and legacy mapping review

In the captured `payload.tables`, `_Migrations` must be a contiguous prefix of the candidate manifest with exact matching checksums. The verifier enforces this through the real migration runner. Build-time generated SQL includes money triggers: compare bundled checksums, not just raw SQL-file hashes. A checksum mismatch is a stop condition; do not edit applied history or markers.

For pre-v11 backups, inspect **both** group policy tables with `scripts/audit-branch-policy-mapping.sql` on the isolated restored copy and enumerate all `PackageBranch` assignments. v11 permits only package `9ff78b23-f681-4007-a44c-ef4277decf17` to branch `f7318524-db7c-49cf-8bc4-bfc6ff5c6b97`, with a verified branch association. Additional policies, missing associations and collisions require explicit decisions before migration changes. Do not infer a first branch. v11+ data has branch columns instead of package columns.

## Recovery readiness and approval gate C

Local encrypted-backup recovery preparation has subsequently been approved and completed. See [the local recovery report](STAGING_LOCAL_RECOVERY_REPORT.md) for exact commands, tests and future emergency approvals. This does not authorize or implement live restoration or final backend publication.

No live restore endpoint is implemented. Native PITR is per-object and generally limited to the provider's retention window; retain account, namespace, object ID, exact bookmarks, capture time, backup digest and release artifacts. A local logical restore is **not** a native PITR restore rehearsal. Before upgrade approval, review and separately approve a recovery implementation or obtain Cloudflare-assisted recovery arrangements; do not claim the current maintenance bundle can restore a live object.

A future restoration would need to operate under migration-free maintenance code, use the exact verified bookmark, preserve the returned undo bookmark securely, and coordinate the object restart. Never restore and immediately allow the normal constructor to reapply the failed migration. Native restoration rolls back SQL and KV state, including financial changes after the bookmark. Reconcile provider events and any later legitimate payments before reopening traffic. A logical import into live storage is a different operation and is not authorized or implemented.

Only request upgrade approval after the real export passes restoration, mapping review, preservation checks, schema parity and a usable recovery procedure is agreed. Re-export if any writes resume. Candidate publication is `npm run cloudflare:deploy:staging`; it restores cron and can trigger migrations immediately, so all gates precede that command. Preserve namespace/class/object identity, verify the live ledger and business records, then resume acceptance testing. Retire the maintenance secret only after the maintenance/recovery window closes, under the approved operational plan.
