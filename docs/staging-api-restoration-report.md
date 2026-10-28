# Staging API access restored

Verified: **2026-10-28 07:29 UTC / 15:29 Asia/Shanghai**.

Staging URL: https://hair-salon-backend-staging.icy-dew-e559.workers.dev

| Item | Result |
| --- | --- |
| Worker | `hair-salon-backend-staging` |
| Active application version | `7d7feaa2-f1bb-4be5-99d4-3b585e40bd14` at 100% traffic |
| Replaced maintenance version | `606bbd64-4780-4c6a-954d-eea320113eb1` |
| Database migration version | v19 |
| Pending migrations in restored artifact | **None** |
| Transactional email delivery | Inactive; restored artifact has no outbox processing code |
| Cron schedules | **0**, preserved from maintenance configuration |
| Production | Untouched |

## Compatibility and data preservation

Before changing traffic, the live maintenance endpoint was authenticated and its database identity matched the existing `salon-v1` object. A fresh read-only export showed v19. Schema, all table rows, and key/value contents matched the previously verified pre-upgrade backup exactly.

The exact prior application artifact was retrieved through Cloudflare's [version-specific API with `include=modules`](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/). Its returned version ID was checked before inspecting the code. The traditional script-content endpoint returned current maintenance content despite version query parameters; that content was **not** used as compatibility evidence.

All **19 bundled migration SQL hashes and recorded checksums** matched the live ledger. Candidate and database migration counts are identical, so restoring this artifact has no pending migration to execute. Its Durable Object binding uses the existing namespace `2fdf4c973d96486bbf32c610f9a2cd89`, class `SalonDatabase`. The candidate has no `.emailOutbox` delegate calls, transactional-email activation flag, or uncertain-delivery processor code. Its source SHA-256 is `5e75babfcafb4d8527da412fd3c7917931794b6ca5b37f0d7771e0179130708c`.

Only the existing version's traffic allocation was deployed. No current working-tree build or unfinished email change was uploaded. No pending v20/v21/v22 SQL, database reset/recreation, account change, password reset, bootstrap, or secret update was performed. No real emails or test bookings were created.

Existing backups remain intact. Additional evidence is stored in the ignored local directory `.maintenance-backups/staging-access-restoration-20261028/`:

- `staging-envelope.json`: fresh read-only capture; sensitive, do not commit/share.
- `staging-envelope.json.dpapi`: Windows CurrentUser encrypted copy.
- Backup payload SHA-256: `06d7cf422affd9588e9fa88373bd087c83b98bb49e17194af72f2b7d562f3e0e`.
- SQLite restore/integrity and foreign-key checks passed.
- `candidate/`: exact previous-version modules and manifest.
- `compatibility.json`: migration/binding checks.
- `restoration-receipt.json`: active deployment, schedules, CORS and HTTP probes.

## HTTP verification

| Request | HTTP | Meaning |
| --- | --- | --- |
| GET `/` | 200 | Existing application health/welcome endpoint |
| GET `/api/v1` | 404 | Existing API prefix has no root health handler; this is an application JSON 404, not maintenance |
| GET `/api/v1/brand` | 200 | Public frontend metadata works |
| GET `/api/v1/brand/theme` | 200 | Frontend theme works |
| GET `/api/v1/branches` | 200 | Branch API and database initialization work |
| GET `/api/v1/services` | 200 | Service catalog works |
| GET existing `/api/v1/packages/:packageId` | 200 | Existing public package detail works |
| GET `/api/v1/packages` without bearer token | 401 | Existing authenticated list contract preserved |
| GET `/api/v1/appointments/my` without bearer token | 401 | Authentication guard preserved |
| GET `/api/v1/wallet` without bearer token | 401 | Authentication guard preserved |
| GET `/api/v1/refund-requests` without bearer token | 401 | Authentication guard preserved |
| POST `/api/v1/auth/login` with empty JSON | 400 | Login route and input validation available; no credentials reset or guessed |
| GET `/__maintenance/target` | 404 | Maintenance route is no longer exposed |
| OPTIONS `/api/v1/branches` from configured frontend origin | 204 | Exact allowed origin and credentialed CORS confirmed |

All 13 final HTTP probes and the frontend CORS probe passed their existing route contracts. Initial smoke expectations incorrectly assumed the package list was public; source inspection confirmed it requires authentication. Likewise `/api/v1/banners` is not a list route (the catalog path is `/api/v1/banners/active`). No route/authentication behavior was changed to satisfy these probes.

## Remaining limitations

- Frontend developers should use their existing valid login or bearer tokens. A successful owner login/session was not tested because valid matching owner credentials were not available locally; public reads, auth guards and login validation were verified.
- `/api/v1` itself remains 404. Use `/` for health and the existing `/api/v1/...` endpoints for application calls.
- All cron triggers remain paused, including pre-existing appointment/group-expiry, completion and reminder jobs. This keeps restoration restricted to API access. Email scheduling must remain inactive; other job activation should be considered separately with its business side effects.
- The restored application is the last deployed compatible version, so subsequent local review/email/schema changes are not live. Pending email migrations and current implementation work remain local and require a separate reviewed release.
- Real provider delivery and inbox receipt remain unverified. No email test endpoint was invoked during restoration.
