# Cloudflare staging Super Admin seed

Prepared on 2026-11-18. Reads the existing `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, optional `SUPER_ADMIN_PHONE` and bcrypt cost from the local environment / `.env`. Passwords and hashes are not printed, persisted to a new file, or uploaded as Worker secrets.

## Completed staging deployment

With explicit user approval, the verified v43 Worker was deployed to staging on 2026-11-18. Worker version: `2c55843d-f73d-4f42-bb90-113efc4944d4`. URL: `https://hair-salon-backend-staging.icy-dew-e559.workers.dev`. The public root returned HTTP 200. Production was not deployed or modified.

The staging migration ledger is now v43 and matches the prepared migration history. The seed created `boss@example.com` (Platform Administrator), account ID `20f67ecf-f41e-4fff-b577-94e99c6556eb`, with role SUPER_ADMIN, status ACTIVE, emailVerified true and mustChangePassword false. Its bcrypt hash was verified against the existing local environment password without printing credentials. A subsequent read-only run verified the same account and reported `created: false`; no account was overwritten. HTTP login was not exercised.

The read-only Branch check found all 9 branches assigned to the single existing Brand, zero NULL brandIds and zero invalid owners. Branch.brandId remains nullable. Brand.ownerId was not backfilled, and route authorization rules were not changed.

The prepared v43 artifact still matches its verified release manifest (3,911,616 bytes). Latest schema support already includes SUPER_ADMIN. Do not insert the new enum value into an older deployed runtime: `--apply` refuses to create it until the staging migration ledger is at least v43 and matches the prepared migration history.

## Commands

Read-only preflight:

```powershell
npm run seed:super-admin:cloudflare
```

After the v43 Worker is deployed and initialized, create the configured account:

```powershell
npm run seed:super-admin:cloudflare -- --apply
```

This command targets only the fixed `hair-salon-backend-staging_SalonDatabase` namespace and `salon-v1` object. It verifies namespace identity and ledger checksums. It does not deploy, apply schema migrations, create an endpoint or modify Worker secrets. It needs the current Cloudflare CLI authentication (or an explicitly supplied CLOUDFLARE_API_TOKEN).

The insert is parameterized, uses bcrypt, creates ACTIVE/verified SUPER_ADMIN with `mustChangePassword: false`, and never promotes or overwrites an existing account. Existing matching Super Admin credentials are verified and left unchanged. Conflicting roles/phone numbers or a different existing password stop the command. Concurrent runs create one account. No Brand ownership, other users, financial data or route authorization rules are changed.

`prisma/seed-super-admin.ts` remains the PostgreSQL seed entry point. Running it does not copy data into Cloudflare; this separate staging SQL API command is required. Creating the role does not add permissions to existing routes that explicitly allow only BRAND_OWNER or other roles.

## Tests and files

`node --test cloudflare/super-admin-seed.test.mjs`: **7 passed, 0 failed/skipped/cancelled**, using disposable SQLite. Covers dry-run zero writes, bcrypt/flags, repeat preservation, role conflicts, changed-password preservation, phone conflicts, concurrent creation and invalid credentials.

Files added: `scripts/seed-cloudflare-super-admin.mjs`, `scripts/lib/cloudflare-super-admin.mjs`, `cloudflare/super-admin-seed.test.mjs`. `package.json` adds the staging seed command. Application seed/auth/schema logic and local credentials were not edited by this task.
