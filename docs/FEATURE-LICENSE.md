# Single-client feature licensing

## Diagnosing deployed 500 responses

A disabled feature should return 403 after authentication, not a database startup error. If public discovery also fails, inspect Worker startup logs before changing feature policy. `MIGRATION_HISTORY_MISMATCH` now reports all mismatched versions and bounded schema checksums without SQL, credentials or business rows.

The Salon staging v45 incident was a verified LF-to-CRLF conversion: the stored v45 checksum was `3d982cd34ada96fe64d0f53d5923b026d914f06f150c79d9d596c5541c628cbb`; the converted file produced a different checksum. Restoring the exact LF source matches the stored history without a database reset, ledger rewrite or schema change. `.gitattributes` pins applied LF migrations 42, 43 and 45. The build also verifies their known historical hashes before upload. Other applied migrations are not silently normalized, and the runtime checksum guard remains strict. New schema changes must use a new migration.

When verifying a disabled feature, an unauthenticated purchase request should still return 401; use a valid customer session to test the feature's 403 response. Public `/api/v1/features` reports the deployed `GROUP_BUYING` state without creating a purchase.

Edit `src/app/config/feature-license.config.ts` for this client's deployment. The configuration is compiled into the Merchant Worker; changing it requires rebuilding and redeploying. There is no public license editing endpoint, and the separate Platform database does not override these switches. This release preserves the supplied settings, including `WALLET.enabled=false` and `BRANCH_STORE.branchLimit=5`.

`GET /api/v1/features` returns the current license/feature dates, availability, reason/status and branch limit with `Cache-Control: no-store`. Use this for frontend visibility. API and service checks enforce the license independently of frontend visibility.

| Feature | Disabled or expired behavior |
| --- | --- |
| BRANCH_STORE | Maximum one branch can be created; all existing active/inactive branches count for their brand. Existing branches remain usable. Active feature uses the configured positive safe-integer limit. Ownership and Serializable transactions remain required. |
| GROUP_BUYING | New purchases through either checkout route, new purchase payments and package catalog routes are blocked. Existing paid voucher redemptions, purchase history, outstanding settlements, cancellation/refund and policy reads remain available. No new DIRECT_BOOK purchase flow is enabled. Fully paid legacy purchases keep their valid remaining redemptions. |
| HAIRSTYLIST | Staff management/portfolio/selection routes are blocked. Normal automatic or genuinely staff-free booking continues under existing availability, schedule and capacity checks. Disabled selection does not bypass staff eligibility. |
| WALLET | New top-ups, initial appointment wallet payments and initial group-purchase wallet payments are blocked at their routes and services. Balance/history, existing deposit remainder settlement, refunds and authenticated provider callbacks retain their checks. No balances are erased. |
| REVIEWS | Review creation and direct/branch/staff review routes are blocked. Existing records are retained. |

Global license disabled/expired makes all five features unavailable. Ordinary booking, authentication and the existing-obligation paths above are not a blanket application shutdown. Expiry is inclusive at the deadline; malformed expiry/start dates and invalid branch limits fail closed. Disabling BRANCH_STORE is a downgrade to one-branch creation, not deletion of existing branches.

Paid group redemptions retain `CONFIRMED`, `PAID`, zero additional appointment price, the original `qrAvailable`/`additionalPaymentRequired` fields and QR verification rules. Their cancellation snapshot uses `GROUP_CANCEL`. Voucher ownership, payment state, immutable/legacy validity, package/branch eligibility, remaining quantity, staff conflicts and branch capacity are revalidated in the transaction, with the purchase row locked before counting redemptions. Purchase revenue is not counted a second time as appointment revenue.

## Cloudflare release

Additive SQLite migration **v45** adds nullable `BrandSubscriptionAddon.branchLimit` to match the latest Prisma schema; existing assignments keep NULL and all historical values. v1–v44 are immutable. Preservation, injected-failure rollback, foreign keys and repeated-startup checks cover the upgrade.

Merchant `wrangler.jsonc` binds only its exported `SalonDatabase`. The unused Platform binding and unapplied `v2` class migration have been removed; the deployed Merchant staging tag was read-only verified as `v1`. This does not change the separately deployed Platform Worker/database. No production migration, remote data write or actual deploy was performed during preparation.

From the repository root:

```powershell
npm run cloudflare:prepare:staging
node scripts/build-cloudflare.mjs --test
node --import tsx --test cloudflare/feature-license.test.mjs cloudflare/booking-regression.test.mjs cloudflare/group-refund-safety.test.mjs
node --import tsx --test --test-concurrency=1 cloudflare/feature-license.integration.test.mjs cloudflare/optional-staff.integration.test.mjs cloudflare/branch-limit.integration.test.mjs
npm run cloudflare:check:staging
```

Financial regression fixtures explicitly enable a wallet license in the disposable test build; the shipped client remains wallet-disabled. Feature tests separately cover disabled/expired/global-off behavior, route aliases and direct service calls. The historical subscription fixture calculator is retained only in `cloudflare/test-support/legacy-subscription-pricing.ts`; no removed Merchant Platform API was restored, and no test control/calculator is bundled in the production Worker.

After reviewing successful checks, the operator can deploy the Merchant staging Worker with:

```powershell
npm run cloudflare:deploy:staging
```

This last command performs a real deployment; it is not a dry-run.

## Verified release checks

| Check | Result |
| --- | --- |
| Feature policy, booking, refund, authentication and notification Node regressions | 187 passed, 0 failed |
| Existing Cloudflare API suite | 48 passed, 0 failed |
| Feature/obligation, optional-staff, concurrent branch limit, staff availability/schedule and subscription Worker suites | 62 passed, 0 failed |
| Exact production bundle license and production boot/source-integrity tests | 3 passed, 0 failed |
| Total automated tests above | 300 passed, 0 failed, 0 skipped |
| Node/Worker Prisma validation, TypeScript, SQLite schema parity | Passed |
| Migration preservation/rollback/foreign keys/repeat startup through v45 | Passed |
| Production artifact verification and staging deploy dry-run | Passed |

The final dry-run bound only `SALON_DB`, with approximately 7896 KiB upload / 2151 KiB gzip. The production smoke test confirms the actual shipped license configuration, authentication checks and absence of test controls or license mutation endpoints. Source-map checks match production sources to the working tree. All previously existing SQLite migrations, the client license configuration, `.env`, package.json and package-lock.json remain byte-for-byte unchanged from the start of this work. Existing owner-deleted Platform API files were not restored.

Implementation changes cover feature utilities/discovery, group/wallet/branch/checkout entry points and branch validation, generated Cloudflare schema metadata, additive v45 and the corresponding build/configuration/release checks. Test fixtures explicitly model licensed clients and the brand owner/brand ID required by the current API; their behavioral and financial assertions remain enforced. No unresolved blocker remains in the checked release scope. No actual deployment, remote data modification or secret update was performed.
