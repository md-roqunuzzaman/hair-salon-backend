# Latest schema: Cloudflare v43 preparation

Historical preparation report: v43 was subsequently deployed with explicit user approval and the staging Super Admin created; see `cloudflare-super-admin-seed.md`. The subsequent subscription schema/pricing release is documented in `subscription-cloudflare-release.md` (v44).

Prepared on 2026-11-18 from the complete current `prisma/schema`. This supersedes the temporary Branch-only snapshot preparation. **No deployment, live data backfill, owner assignment, Super Admin account creation, PostgreSQL write or secret change was performed.**

## Included schema

- Nullable `Branch.brandId` / `Branch.brand`, inverse `Brand.branches` and its index remain in v42. Its safe singleton-brand NULL backfill is unchanged.
- Nullable `Brand.ownerId` / named `Brand.owner` User relation, inverse `User.ownedBrands` and `Brand_ownerId_idx` are now included in generated SQLite schema/client/adapter metadata.
- `Role.SUPER_ADMIN` is included in both generated clients. SQLite roles use TEXT, so no PostgreSQL `ALTER TYPE` statement is sent to Cloudflare and no separate SQL migration is needed solely for that enum value.

New SQLite migration `0043_brand_owner_relation.sql` adds the nullable owner column, User foreign key (delete RESTRICT / update CASCADE) and non-unique index. It never guesses or backfills an owner, changes an existing role, or rebuilds Brand/User tables. Existing Brand owners remain NULL until explicitly assigned. Branch ownership and historical data remain unchanged by v43.

The owner's Prisma source, PostgreSQL migration candidates and seed implementation were preserved. The PostgreSQL Super Admin bootstrap script was not run; `seedInitialData()` still calls the existing Brand Owner and Brand seed functions. Supporting the enum does not itself grant additional route permissions or create a privileged account.

## Verification

| Check | Result |
| --- | --- |
| Node and Cloudflare Prisma validation/client generation | Passed |
| TypeScript | Passed |
| Normal `npm run cloudflare:prepare:staging` | Passed end to end |
| Generated schema versus v1-v43 SQL parity | Passed |
| Historical migrations and v42 zero/one/multiple-brand backfill cases | Passed |
| Populated v42-to-v43 preservation, injected-failure rollback, owner index/FK, delete restriction, update cascade, multiple owned Brands and repeated initialization | Passed |
| Real Worker Branch/Brand ownership, SUPER_ADMIN round-trip, branch-limit, no-show and exact production-artifact checks | **7 passed, 0 failed/skipped/cancelled** |
| Staging upload dry-run | Passed: **7857.08 KiB / gzip 2143.38 KiB** |

Production Worker is **3,911,616 bytes**. The release manifest reports v43, 94 unchanged historical migration files and production fixture isolation. Test controls are excluded from the production artifact. The expected injected no-show storage failure remains covered by the passing rollback/recovery test.

The full unrelated API/security aggregate was not rerun for these additive schema changes. Live ledger/recovery checks and deployed smoke testing remain release-time work; the earlier live Branch preflight is historical evidence, not confirmation that v42/v43 have been applied.

## Normal workflow restored

The complete schema now validates, so temporary `prepare-branch-brand-schema.mjs` / `prepare-branch-brand-release.mjs` helpers were retired. Do not use their old commands. Normal commands again build directly from the current source schema:

```powershell
npm run cloudflare:prepare:staging
npm run cloudflare:check:staging
```

When you choose to publish staging yourself:

```powershell
npm run cloudflare:deploy:staging
```

On object initialization the runtime applies only pending migrations atomically with their ledger entries. Preserve the existing namespace, class and `salon-v1` singleton, and retain a usable recovery point and a v43-compatible recovery Worker. An older Worker rejects the newer migration ledger.

After deployment, verify Branch ownership using the existing staging-only, read-only command:

```powershell
node scripts/backfill-cloudflare-branch-brand.mjs
```

Expect zero NULL/orphan branch owners after v42's singleton backfill, provided the live database still has exactly one Brand. Keep Branch.brandId nullable until that verification passes and the branch-creation write path supplies brandId. Brand.ownerId also remains nullable; owner mapping and making either field required are separate changes.

## Files updated in this follow-up

`cloudflare/migrations/0043_brand_owner_relation.sql`; generated Cloudflare schema/metadata and ignored Prisma clients; migration registration, schema checker and release verifier; the owner migration fixture and migration test routing/runner; the existing Branch/Brand disposable Worker fixture and integration tests; current/historical release documentation. The temporary Branch-only helpers were removed. No application/authorization/seed business logic was edited.
