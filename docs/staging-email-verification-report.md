# Staging deployment and merchant-provider verification

**Current status update, 2026-10-28 07:29 UTC:** staging API access has been restored to application version `7d7feaa2-f1bb-4be5-99d4-3b585e40bd14`, using the existing v19 database without pending migrations. Transactional email remains inactive and cron schedules remain paused. See the [staging API restoration report](staging-api-restoration-report.md). The sections below retain the earlier maintenance/email-verification audit history.

Run date: 2026-10-28. **Stopped at the required-configuration gate. Latest application deployment and real email testing have not occurred.**

## Earlier staging state before API restoration

- Account: `b57cd96d4a71d1b21f38db1b04f4dea8`.
- Worker: `hair-salon-backend-staging`.
- URL: https://hair-salon-backend-staging.icy-dew-e559.workers.dev
- Previous application version: `7d7feaa2-f1bb-4be5-99d4-3b585e40bd14`.
- Current version: existing read-only maintenance implementation, `606bbd64-4780-4c6a-954d-eea320113eb1`.
- Database namespace preserved: `2fdf4c973d96486bbf32c610f9a2cd89`; class `SalonDatabase`; singleton `salon-v1`.
- Authenticated maintenance identity matched the previously recorded database identity. Application requests currently return maintenance responses; cron triggers are paused by the maintenance configuration.
- Production was not deployed. Existing secret values were not printed, overwritten, or rotated.

## Preflight and backup evidence

Cloudflare authentication and staging deployment metadata were checked. Secret-name inventory includes `EMAIL_ENCRYPTION_KEY`, existing platform SMTP/JWT/storage/payment secrets, and `MAINTENANCE_TOKEN`. Microsoft OAuth client/redirect secrets are absent. Secret-name presence alone does not certify the deployed encryption-key value or SMTP connectivity.

Fresh backup capture time: `2026-10-28T06:48:12.752Z`.

- Local backup: `.maintenance-backups/email-provider-20261028/staging-envelope.json` (ignored; contains sensitive database records).
- Windows CurrentUser encrypted copy: `.maintenance-backups/email-provider-20261028/staging-envelope.dpapi` (ignored).
- Payload SHA-256: `6101e35622916d6e50bc3c4a82ea142e3f6815d6d428f4c54961e1d94ccf7dec`.
- Server double-read consistency and payload hash verified. Explicit UTF-8 decoding corrected an initial PowerShell decoding/hash failure; only matching bytes were saved.
- Encrypted-copy decrypt/hash round trip passed. Byte-oriented DPAPI protection was used because the backup exceeds the SecureString size limit.
- Python SQLite restore, foreign-key check and integrity check passed.
- Applied migration ledger: v19; all existing checksums match the candidate bundle. Pending versions: **v20, v21 only**. No mapping collisions or unresolved mappings.
- Local Miniflare restore/upgrade rehearsal passed through v21: `restored=true`, `migrated=true`, `repeatable=true`, `preservedCells=13319`.
- Latest TypeScript check passed.

No remote application migration has been applied in this run. The current application architecture applies pending migrations on Durable Object initialization; maintenance avoids that initialization until the release gate is satisfied.

## Required-configuration blocker

The locally available owner email, after the login endpoint's trim/lowercase normalization, does not identify a `BRAND_OWNER` account in the fresh staging backup. Consequently owner login and authorized merchant API access cannot be verified with the available login configuration. No password reset, fabricated JWT, account edit, bootstrap, or role bypass was attempted.

An existing encrypted Gmail credential is present and decrypts using the existing local encryption key. This does not establish that the deployed key is identical or that Gmail will accept the credential. Current Gmail settings are disabled and unverified. No merchant setting was modified or automatically enabled.

Per the user's stop instruction, release work stopped before applying migrations or deploying the latest application. Resuming requires valid staging owner access supplied through a secure local mechanism and approval to continue. The staging maintenance state must be explicitly considered when resuming; the prior application version is recorded above for a separately authorized return to service if needed.

## Provider verification results

Only the configured provider is available in this single-brand database. No provider switch or credential replacement was performed.

| Provider | Attempted / skipped | HTTP status | Safe diagnostic | Provider acceptance | Verification state | Inbox confirmation |
| --- | --- | --- | --- | --- | --- | --- |
| Gmail | Skipped: release/owner-access gate | N/A | No SMTP/API attempt | Not tested | Existing disabled, unverified | Pending; no email attempted |
| Microsoft 365 | Skipped: OAuth setup/consent unavailable; not configured | N/A | No API attempt | Not tested | Not established | Not applicable; no email attempted |
| QQ | Skipped: not configured | N/A | No SMTP attempt | Not tested | Not established | Not applicable; no email attempted |
| NetEase 163 | Skipped: not configured | N/A | No SMTP attempt | Not tested | Not established | Not applicable; no email attempted |
| Resend | Skipped: not configured; no verified sender domain established | N/A | No API attempt | Not tested | Not established | Not applicable; no email attempted |
| Custom SMTP | Skipped: prohibited on Workers | N/A | No SMTP attempt | Not tested | Not established | Not applicable; no email attempted |

Real attempt count: **zero for every provider**. Authorized recipient remains `khanrokon571@gmail.com`; future attempts must use only the existing direct `/test-email` endpoint, sequentially, once per available provider, without automatic retry or automatic enablement. HTTP/provider acceptance must never be recorded as inbox receipt.

## Outstanding release checks

Pending: valid owner authentication; required pending staging migrations; latest application deployment; application health and authorized/unauthorized endpoint probes; post-migration merchant configuration read; controlled Gmail test and separate user inbox confirmation. Live platform OTP delivery was not invoked because the authorized email send path is limited to merchant `/test-email`. Existing source and mocked-test isolation evidence remains documented in the provider guide; live OTP delivery is not certified by this run.

No outbox scheduler, booking email trigger, marketing/bulk send, or business-logic change was activated. Existing application cron processing is temporarily paused by maintenance, rather than being changed in application source.
