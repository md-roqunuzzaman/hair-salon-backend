# Staging API 500 — restored existing version

2026-11-05. **The reproduced global HTTP 500 outage is resolved.** The owner explicitly approved restoring only existing version `f3a81cae-4504-4a3e-8035-a58b0d2d1882`. The historical currency backfill remains unapproved/unexecuted.

## Cause and approved action

Before restoration, GET `/`, `/api/v1/brand` and `/api/v1/packages` all returned JSON HTTP 500. Even the root route, which does not query business data, failed before Express could respond.

Deployment history showed staging switched at **2026-11-05T09:38:29.029766Z** to historical version `f17d4554-b7d2-477c-b9da-7d659387fff3` (uploaded 02:57:59). Runtime exception events repeatedly contained:

`Database migration mismatch; applied migrations must remain immutable`

The failing Durable Object initialization gate prevented ordinary requests and scheduled tasks from running. The store's last verified ledger already contained versions 1–36. This is a deployment/migration-checker compatibility failure, separate from the known financial-report currency 409.

The safe restoration target was existing, previously working version **`f3a81cae-4504-4a3e-8035-a58b0d2d1882`**, uploaded 08:25:27. Its inspected artifact contains all 36 matching migration definitions. Both version metadata records retain the same SQLite Durable Object namespace/class, compatibility settings and staging delivery flag.

API-downloaded script content did not reliably distinguish the historical version payload during inspection. No exact historical migration maximum is claimed from that content. The diagnosis is supported by the actual failing deployment identity, migration-mismatch runtime exceptions and successful targeted restoration/read-back verification.

After the owner's explicit approval, executed only:

```powershell
npx --no-install wrangler versions deploy f3a81cae-4504-4a3e-8035-a58b0d2d1882@100 --env staging --yes --message "Restore previously verified v36-compatible staging version after migration-checker mismatch; no data repair"
```

Cloudflare confirms a new deployment at **2026-11-05T10:09:37.417215Z**, routing **100%** to that existing version. No new Worker code was uploaded. No database reset, ledger edit, new migration, schema change, currency repair or Brand change was executed.

Wrangler also synchronized checked-in non-versioned diagnostic settings (`logpush=false`, observability enabled, sampling rate 1); the CLI receipt records that standard command behavior. Database namespace, binding names/compatibility and `EMAIL_OUTBOX_ENABLED=true` were checked. Secrets were not changed. Existing cron and staging delivery resume under the approval; no manual payment/refund/email action or test login was initiated.

## Verified results

**9/9 live HTTP contract probes pass:**

| Route | Result |
| --- | --- |
| `/` | 200 |
| `/api/v1/brand` | 200; HKD / Asia/Hong_Kong |
| `/api/v1/services` | 200 |
| `/api/v1/branches` | 200 |
| Existing public `/api/v1/packages/:packageId` | 200 |
| `/api/v1/packages` without login | Expected 401 |
| `/api/v1/appointments/my` without login | Expected 401 |
| `/api/v1/wallet` without login | Expected 401 |
| `/api/v1/reports/payments` without login | Expected 401 |

All nine retain nosniff and omit X-Powered-By. An initial probe incorrectly expected package-list GET to be public; source authorization confirmed 401 is the required contract. The corrected final run passed all nine checks.

Post-restoration SQL reads succeeded. The ledger remains **v36**, with all checksums identical to the verified before-state; no new migration applied. All **38 historical GroupPurchase currencies remain NULL**, confirming the separately proposed backfill was not executed. Existing delivery remains true and the Durable Object namespace is unchanged.

No application source was edited or rebuilt for this restoration. The known financial-report historical-currency 409 still requires its separate [approval plan](historical-currency-repair-plan.md); authenticated business workflows/report totals were not newly certified by unauthenticated probes. Existing backend functionality and security responses are available again.

Evidence: ignored `node_modules/.cloudflare-test/staging-500/` contains the approved CLI receipt/exit code, sanitized migration-error events, version metadata and independent post-restoration HTTP/ledger verification. Credentials, request headers/cookies and raw error messages are excluded from retained tail summaries.

Do not select a historical application version that rejects the live ledger as an automatic rollback. Preserve applied migrations and use a compatible existing artifact; never remove ledger rows or weaken the migration checker to recover availability.
