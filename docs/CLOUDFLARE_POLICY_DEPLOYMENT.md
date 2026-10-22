# Cloudflare cancellation/refund deployment

Target: `hair-salon-backend-staging`, using `SALON_DB` / `SalonDatabase` and the existing `salon-v1` singleton. The Worker bundles SQLite migrations 1–12. This is not a PostgreSQL deployment and does not use D1 or external Redis.

## Local release checks

```powershell
npm run test:regression
npm run typecheck
npm run cloudflare:check:staging
```

The final command builds the production Worker, verifies generated schema against the SQLite migration chain and performs a staging dry-run without publishing. The regression suite checks populated-database upgrades, rollback for unmapped policies, immutable checksums, existing route compatibility, booking/payment flows and merchant refund APIs. Disposable tests use simulated Stripe responses; they do not prove real provider delivery.

## Existing database gate

Before publishing, retain a recoverable backup/recovery point for the staging Durable Object and inspect the existing migration history. Never reset the object, rename `SalonDatabase`, change `salon-v1`, or modify an applied migration to pass a checksum check.

For a database below v11, run the read-only queries in `scripts/audit-branch-policy-mapping.sql` through the existing authorized database inspection mechanism. Do not use `wrangler d1 execute`: this application stores data in a Durable Object. The v11 mapping covers only package `9ff78b23-f681-4007-a44c-ef4277decf17` to branch `f7318524-db7c-49cf-8bc4-bfc6ff5c6b97`, with a verified package/branch relationship. Additional or unassigned legacy policies cause the migration to abort. Resolve those mappings explicitly before deployment; never remove the guard. If the database is already v11+, inspect the branch policies instead of querying removed package columns.

Applied migration versions and checksums must match the bundle. On initialization, the Worker checks existing checksums, then applies each pending migration transactionally. Cron can initialize the object immediately after publication; the data gate must be completed before publishing.

## Staging configuration and publication

Use the existing Cloudflare account and staging secrets. Inspect names without printing values:

```powershell
npx wrangler whoami
npx wrangler secret list --env staging
```

Verify independent JWT secrets, exact frontend `CORS_ORIGIN`, Stripe test credentials and the correct webhook signing secret, SMTP settings and R2 credentials as described in `cloudflare/README.md`. Local `.env` does not configure deployed bindings. No new cancellation/refund enable flag is required. `ENABLE_BOOK_NOW_PURCHASE` controls only Direct Booking and should retain its existing setting unless that feature is explicitly being enabled. Do not rerun `/__setup` for an existing database.

After the data and configuration gates pass, publish explicitly:

```powershell
npm run cloudflare:deploy:staging
npx wrangler tail --env staging
```

## Deployed acceptance

Import the Postman collection and staging environment from `docs/postman`. Supply customer/owner tokens and actual staging resource IDs, then follow `docs/CANCELLATION_REFUND_POLICY_API.md`.

- Read/update all three branch policies and verify role/version restrictions.
- Book PAY_NOW, DEPOSIT and RESERVE_NOW; verify saved terms, previews, cutoffs, zero/partial refunds and released capacity.
- Purchase and redeem a group package; verify early restoration, late forfeiture, active-booking refund rejection and duplicate protection.
- Approve and process a Wallet refund; verify original paid/bonus balances and retry safety.
- Complete a real Stripe test payment, process an approved refund and verify signed events at `/api/v1/payments/stripe/webhook`, including `refund.updated` for pending refund completion. Verify only one refund and completion record after replay.
- Verify actual frontend confirmation, SMTP delivery, R2 access and cron logs.

Positive refunds retain owner approval before processing. Automatic financial approval and initial Direct Booking whole-purchase cancellation are separate unresolved product decisions. They are not silently enabled by deployment.

## Recovery and scope

If initialization reports a migration/mapping/checksum failure, stop acceptance and investigate the stored data and migration history. Do not clear markers or reset storage. If an application rollback is needed after migration, use a version verified against the upgraded schema; rolling back Worker code does not reverse database migrations. Provider timeouts require reconciliation of the existing refund attempt, never a replacement refund.

PostgreSQL rollout remains separate: the existing decimal precision migration sorts before columns it alters and requires migration-history inspection and rehearsal on the actual PostgreSQL environment. Cloudflare SQLite verification does not certify PostgreSQL. Production publication requires its own data/configuration review and deployed acceptance.
