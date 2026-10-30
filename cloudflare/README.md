# Cloudflare deployment

## Cancellation/refund policy minutes — v29 local candidate

Only the requested cancellation/rescheduling, refund-tier and preview fields change from hours to minutes. See the complete field map and current Postman examples in [the policy API guide](../docs/CANCELLATION_REFUND_POLICY_API.md). Existing durations are preserved: 12 hours becomes 720 minutes, 2 becomes 120 and 24 becomes 1440. New requests can set 30/90-minute thresholds. API paths, money calculations, permissions, notifications and unrelated time settings remain unchanged. Frontend clients must update both the field names and units together; old hour request fields are not minute aliases. Preview elapsed-minute values may be fractional.

SQLite `0029_policy_time_minutes.sql` and PostgreSQL `20261030060000_policy_time_minutes` convert live policy columns/defaults and editable JSON tiers once. Invalid/conflicting JSON units and overflow fail closed. Existing checkout/refund/audit snapshots are not rewritten; detached normalization preserves their original thresholds and boundary modes during evaluation. Versions, timestamps and historical financial records are retained. Repeated migration initialization does not multiply values again. Old migration files remain unchanged.

This is a local candidate, with no live migration or deployment. Use the existing `npm run cloudflare:prepare:staging` checks before a separately approved rollout, verify a fresh usable backup/live ledger and coordinate the frontend contract change. Worker initialization applies pending SQLite migrations; never run PostgreSQL SQL against Workers. After v29, recovery requires a v29-compatible binary; a pre-v29 application is not an automatic rollback. Staging/production email flags and credentials were not changed by this conversion.

Local verification on 2026-10-30: `npm run test:regression` exited 0 with **280 TAP tests passed, zero failed/skipped**. Tests include 30/90-minute cutoff boundaries, actual 30-minute rescheduling and preview APIs, legacy snapshot financial equivalence, group refund age in minutes, invalid/conflicting units, migration overflow/rollback and repeated startup without double conversion. Node compilation, schema parity, financial/booking/email regressions and historical route checks passed. PostgreSQL Prisma schema validation passed; no live PostgreSQL upgrade was run. The protected historical backup restored/upgraded locally to v29 with 13,319 original cells checked, allowing only the explicit value/name conversions; it is not a current live backup. Ignored logs are `node_modules/.cloudflare-test/policy-minutes-{regression,prepare,backup}.log`.

Latest standalone TypeScript and Cloudflare build/artifact checks passed; the manifest records v29 and 91 unchanged historical SQL files. A concurrent payment-history feature edit temporarily interrupted the aggregate preparation command and was subsequently updated outside this time-unit task. The 280-test regression result above predates those independent payment-feature edits and does not certify that separate feature; rerun aggregate preparation/regression for the combined workspace before release. This task preserves those shared edits and does not change payment-history/refund-eligibility business rules. Latest logs: `policy-minutes-latest-typecheck.log` and `policy-minutes-build.log` in the ignored test directory.

## Registration email verification — v28 local candidate

The registration/verification changes are included in the Cloudflare bundle. SQLite `0028_registration_email_verification.sql` adds User.emailVerified (default false) and nullable emailVerifiedAt. As explicitly requested, customers present during the one-time migration retain access via emailVerified=true; no historical OTP verification timestamp is invented. New registrations remain unverified and repeat initialization never verifies them. Existing customer/account, booking, payment, notification and email history records are retained. v1-v27 SQL is unchanged.

The supplied PostgreSQL schema migration `20261030014939_add_email_verification` is retained unchanged. A separate `20261030020000_preserve_existing_customer_access` migration uses that migration's successful ledger timestamp to preserve access only for customers created before its application. Do not run PostgreSQL migrations against Workers. PostgreSQL schema validation is not a live PostgreSQL upgrade rehearsal.

Public requests (JSON, no owner token required):

```http
POST /api/v1/auth/register
{"name":"Test Customer","email":"your-approved-test-address@example.com","password":"StrongPassword123!"}

POST /api/v1/auth/verify-email
{"email":"your-approved-test-address@example.com","otp":"123456"}

POST /api/v1/auth/resend-verification-otp
{"email":"your-approved-test-address@example.com"}
```

Registration returns 201 and emailVerified=false, without an authenticated session or an inbox-delivery claim. Customer login/refresh/protected APIs require verification; staff/owner roles keep their existing exemption. Correct OTP returns 200, sets verification time and consumes the OTP; replay returns 409. Wrong/expired OTP returns 400, fifth wrong attempt returns 429. OTPs expire after five minutes and are stored as keyed HMACs. Resend uses the existing merchant-only security sender, five requests/15 minutes and a 60-second cooldown. Registration limits are five requests/IP/15 minutes and three/normalized email/hour. Worker limits use the edge-managed CF-Connecting-IP captured before the Node HTTP adapter; no broad Express proxy trust or client X-Forwarded-For fallback was added. Node retains req.ip.

Cloudflare's SQLite session adapter now implements the new atomic counter/cooldown, OTP store/verify/consume, reset-token issuance and owner-lock-release operations. The new verify-email EJS template is compiled into the Worker with escape/parity checks; runtime filesystem access is unnecessary. AUTH_EMAIL_VERIFICATION_OTP is supported by owner history filters and stale-SENDING quarantine, with no automatic uncertain replay. OTP bodies/codes are excluded from stored security email history. Provider/booking/payment/outbox selection logic is retained.

Registration sends immediately through an enabled, verified, runtime-ready merchant provider, independently of EMAIL_OUTBOX_ENABLED. A provider failure leaves the account unverified and recoverable through resend; accepted SMTP is not inbox confirmation. No new secret is required: retain the existing persistent encryption key, JWT secrets (at least 32 characters), merchant credentials and database namespace/singleton. The new password-reset implementation uses HMAC OTPs as well, so an outstanding older plaintext reset OTP may require a new request after rollout. Existing reset-token TTL/one-use behavior is retained.

Run `npm run cloudflare:prepare:staging` and `npm run test:regression` locally. Before any separately approved staging deployment, verify a fresh usable backup and the immutable live ledger, keep the frontend API online, and review merchant readiness: real registration requests can send security emails after deployment. This preparation performs no deployment, live migration, secret change or real send; staging's previously authorized true outbox flag and production's false flag remain unchanged. Worker initialization applies only pending versioned SQLite migrations. After v28, retain a v28-compatible recovery artifact; do not roll back to an older migration checker, reset the database or edit its ledger.

Verification on 2026-10-30: the complete `npm run test:regression` exited 0 with **276 TAP tests passed, zero failed/skipped**, including four new registration Worker tests with real SQLite and mocked Gmail sockets. Coverage includes the full verification/login lifecycle, access blocking, HMAC/TTL/attempts, rate/cooldown limits, replay/concurrent verification, failed/uncertain sends, stale security-send quarantine and no platform fallback. Existing booking/customer fixtures now explicitly represent verified accounts; the production access gate is exercised separately rather than bypassed. The standalone adapter fixture uses the current immutable migration runner instead of its stale v22 SQL list. Node compilation, TypeScript, PostgreSQL Prisma validation, fresh SQLite schema parity, v28 rollback/upgrade/repeat tests and historical route checks passed. The supplied register middleware addition is checked explicitly without rewriting the old route baseline. A protected historical v19 backup upgraded locally through v28 with all 13,319 original cells preserved; it is not a current live recovery point. Ignored evidence logs: `node_modules/.cloudflare-test/registration-{regression,prepare,backup,typecheck}.log`.

Final `npm run cloudflare:prepare:staging` exited 0. The release manifest records v28, 91 unchanged historical migration files, registration/template/runtime inclusion, bundle isolation and Worker JavaScript 3,564,284 bytes. No Wrangler deployment command was executed.

## Branch banner carousel — v27 local candidate

The user-added carousel schema/APIs are included in the Worker build. Additive SQLite `0027_branch_banner_carousel.sql` creates the final branch-scoped model: unique required branchId, optional brandId, default imageIntervalMs=5000 and videoIntervalMs=15000. Existing banners, media, branch assignments and email/financial records are unchanged. Previous migration files remain immutable. The supplied PostgreSQL migrations `20261029100537_add_banner_carousel_settings` and `20261029101521_add_branch_carousel_settings` remain unchanged; do not run them against Workers. For a separate PostgreSQL rollout, inspect any intermediate rows with NULL branchId before applying the supplied required-branch migration; do not guess a branch or discard rows.

New admin APIs (Authorization: owner or assigned branch manager):

```http
GET /api/v1/banners/carousel-settings/:branchId
PATCH /api/v1/banners/carousel-settings/:branchId
Content-Type: application/json

{"imageIntervalMs":7000,"videoIntervalMs":20000}
```

PATCH accepts either/both integer fields, 1000–120000 ms; empty, unknown, null and invalid values are rejected. GET returns fallback defaults before the first write. Settings persist per branch; an omitted field retains its existing value. Existing public active-banner response remains unchanged. No new public carousel-settings endpoint was added by this preparation task.

Preparation: `npm run cloudflare:prepare:staging` (local generation/build/schema/upgrade/artifact checks; no deployment). The regression suite includes real Worker API authorization, persistence, partial/concurrent updates and validation tests plus populated migration rollback, uniqueness, foreign-key/cascade and repeat-initialization tests. No live deployment, migration or email is authorized by build preparation. Keep the existing namespace/singleton and verify a current usable backup before any separately approved rollout; Worker initialization then applies only pending versioned SQLite migrations. A pre-v27 binary is not an automatic rollback after v27 because its ledger checker rejects extra versions.

Local verification on 2026-10-29: `npm run test:regression` exited 0 with 272 TAP tests passed, zero failed/skipped; Node compilation, migration/schema checks and 148 historical route assertions passed. PostgreSQL Prisma schema validation passed without running PostgreSQL migrations. The protected historical v19 backup restored and upgraded locally through v27, preserving 13,319 original cells and passing repeated initialization; this rehearsal is not a fresh live backup. Logs are ignored under `node_modules/.cloudflare-test/banner-carousel-{regression,prepare,backup}.log`.

Final `npm run cloudflare:prepare:staging` exited 0: TypeScript, generation, schema parity, v27 upgrade/rollback checks and production-bundle isolation passed. The manifest records 91 unchanged historical migration files, Worker JavaScript 3,546,778 bytes, staging business delivery true and production false. No Wrangler deployment or live database operation was run.

The previously approved staging outbox flag remains true and production remains false. This task changes neither live flags nor merchant settings. A future deployment includes the shared workspace's earlier email candidates as well as carousel changes; review pending v25/v26 migrations and enabled merchant delivery/backlog before approving that release. Never deploy maintenance or reset/seed the database to prepare this feature.

**Current v26 local candidate:** [unified merchant-only email](../docs/unified-merchant-email-system.md) adds enabled/unverified defaults for new configurations while preserving existing owner choices. All authentication and business mail uses the single merchant without platform fallback; sending still requires enabled, verified and provider/runtime readiness. Old skipped/uncertain records never replay. Staging's outbox flag was separately approved true; production remains false. This v26 defaults update is local only and is not deployment or real-send approval. See the dated activation/default sections in the linked guide; older false-flag/retirement instructions below are historical.

For the permanent v23 Email Outbox upgrade, follow the staging-only, delivery-disabled procedure in [transactional-email-system.md](../docs/transactional-email-system.md#permanent-outbox-management-upgrade-v23-local-candidate). This implementation does not authorize deployment, secret rotation, production rollout or real email delivery. Old generic deployment examples below are not activation approval.

For the current merchant/transactional email candidate, follow [transactional-email-system.md](../docs/transactional-email-system.md). Keep the frontend staging API online: implementation checks and migration rehearsals are local; do not deploy maintenance or run live migrations to prepare the build. `EMAIL_OUTBOX_ENABLED=false` keeps business delivery inactive. The v22 candidate includes an additive delivery-fence migration; after it is applied, a historical v19 application is not a compatible rollback. Current restored staging status is in [staging-api-restoration-report.md](../docs/staging-api-restoration-report.md). Live deployment and delivery activation each require separate authorization.

The existing Express routes and services have a separate Cloudflare build. The Node/PostgreSQL entry remains available. No Cloudflare account, production database, real payment or customer email was changed during implementation.

## Runtime

Remaining-payment APIs are included in the Worker Express build: `POST /api/v1/payments/appointments/:appointmentId/remaining-payment/stripe`, `POST /api/v1/payments/group-purchases/:purchaseId/remaining-payment/stripe`, `POST /api/v1/wallet/:appointmentId/remaining-payment/wallet`, and `POST /api/v1/wallet/group-purchases/:purchaseId/remaining-payment/wallet`. They require customer authentication. Wallet requests require `{ "useBonus": boolean }`; Stripe requests use the resource ID. Existing Stripe secrets and webhook endpoint handle the new intents. No additional binding or schema migration is needed. `npm run test:cloudflare:api` covers successful remaining payments, intent reuse, webhook replay, wallet debit amounts, role restrictions and duplicate-payment rejection.

The minute Cron Trigger in both production and staging runs appointment expiry, group-purchase expiry, automatic appointment completion, reminders and session cleanup through the same Durable Object queue. Workers invokes `completeEligibleAppointments()` directly; the Node `node-cron` file is used only by `src/server.ts`. Completion requires CONFIRMED status, full payment, QR verification and elapsed service duration. Transactions include the customer notification and system audit log; repeat runs do not complete an appointment twice. No additional Cron Trigger or schema migration is required for this job.

| Component | Cloudflare implementation |
| --- | --- |
| Express API | Worker with Node HTTP compatibility |
| Relational data | One SQLite-backed `SalonDatabase` Durable Object |
| Prisma transactions | Durable Object async storage transactions, including rollback |
| Redis sessions / OTP / counters | Indexed SQLite session table with expiry and atomic token consumption |
| Images | R2, using existing signed-upload API contracts |
| Password emails | TLS SMTP via Workers sockets (port 465); SMTP credentials required |
| Minute expiry jobs | Worker Cron Trigger through the same database queue |

D1 remains an isolated financial proof under `proof/`; it is **not the production database**. D1's Prisma adapter does not provide the interactive transaction guarantees required by the existing services. This implementation reuses its SQL/result conversion against Durable Object SQL, with real enclosing storage transactions, preserving current service callbacks within Cloudflare.

Money and percentages use integer hundredths with database precision checks and are converted back to the existing Decimal/API representation. Scalar lists use JSON. PostgreSQL row locks are replaced by the singleton request queue plus storage transactions. HTTP requests and expiry jobs share the queue.

The singleton has a 10 GB database limit and serializes requests; load-test expected salon traffic before production. Do not shard or change `salon-v1` without redesigning cross-table transactions. Stripe and OpenAI remain external API integrations already used by the application.

## Local setup and regression

Use Node 20.19+ or Node 22. The pinned Wrangler version supports the repository's Node 20 environment.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Fill .dev.vars with development/test credentials.
npm run cloudflare:build
npm run cloudflare:dev
```

Development data persists under `.wrangler`. Client generation and schema validation do not connect to PostgreSQL. Cloudflare builds replace the Node database, Redis, native bcrypt, SMTP and runtime EJS modules; the deployed entry never imports `src/server.ts`.

The pinned local runtime predates structured Email Service sending. Automated tests capture outgoing mail; verify actual delivery on staging. Negative constraint tests intentionally log the rejected SQL error while reporting a passing test.

Run the automated regression baseline:

```powershell
npm run test:regression
```

This generates both clients, compiles TypeScript and runs auth (8), database retry (4), booking/API fixtures (24), isolated D1 financial proof (12), actual SQLite adapter checks and real Worker HTTP integration. Tests use disposable databases and synthetic credentials. The Worker suite uses real Express middleware/controllers/services and SQLite persistence; outbound email is captured in a test outbox. Stripe signatures are generated locally; no API charges are made. Test fixture endpoints are excluded from the production bundle.

Verified Worker flows: registration/login, one-time setup, protected access, PAY_NOW/DEPOSIT/RESERVE_NOW, price/deposit snapshots, conflicting/concurrent bookings, wallet/ledger updates, duplicate payment rejection, money constraint rollback, cron expiry, refresh rotation/replay rejection, OTP cooldown, password reset/replay rejection, session invalidation, R2 URL signing and signed Stripe webhook replay. Adapter checks cover rollback, array transactions, exact money, row-lock translation, case-insensitive filters and session atomicity/expiry.

This does not certify every workflow. Run the full application regression on staging, including group purchases/vouchers, refunds/approvals, rescheduling/cancellation boundaries, staff capacity/leave, QR verification, salon collection, completion/no-show, admin/reporting/localization, Stripe intent completion/topups, real R2 upload/confirm/delete and real email delivery.

## Deploy staging first

1. Enable Workers Paid in the company's account. Authenticate with `npx wrangler login`, or provide scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your deployment environment.
2. Create a staging R2 bucket and bucket-scoped S3 credentials. Configure bucket CORS for the exact frontend origin, `GET`, `HEAD`, `PUT`, and required upload headers such as `Content-Type`. Signed URLs do not bypass bucket CORS.
3. Configure TLS SMTP: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_SENDER`. For Gmail, enable two-step verification and use a Google App Password; sender should match the authenticated account or an authorized alias. Workers use implicit TLS on port 465; port 25 and STARTTLS/587 are not supported by this application transport. Cloudflare Email Service domain onboarding and the EMAIL binding are no longer required. Upload these secrets to the staging environment and verify real password-reset delivery. Automated tests capture emails and do not certify live SMTP acceptance.
4. Prepare staging secrets with Stripe test keys, staging R2 storage, independent JWT/setup secrets and the actual frontend origin:

```powershell
Copy-Item cloudflare/secrets.example.json .cloudflare-secrets.staging.json
# Replace every example value; keep this ignored file private.
npx wrangler secret bulk .cloudflare-secrets.staging.json --env staging
npm run cloudflare:deploy:staging
```

If Wrangler asks to create the Worker during the first secret upload, create it. The `v1` migration provisions the SQLite Durable Object namespace. No D1 database, PostgreSQL URL or Redis server is needed. Schema initialization is transactional. Each pending versioned SQL migration runs once on object initialization. Version 2 adds the nullable WalletTopup.promotionId relation, preserving historical top-up snapshots and balances. Version 3 adds BranchBookingPolicy.qrVerificationRule with BEFORE_START_TIME as the default; existing policy values remain intact and BEFORE_END_TIME can be configured through the branch policy API.

5. Attach a staging API custom domain in Workers settings. Use the same parent domain as the frontend, such as `app.example.com` and `api-staging.example.com`, to preserve Secure/HttpOnly/SameSite=Lax cookies. Cross-site `pages.dev` to `workers.dev` cookie authentication needs a separate cookie policy review. Enable credentials in frontend requests; `CORS_ORIGIN` must match exactly.
6. Initialize the owner and brand once:

```powershell
$salonApiUrl = "https://api-staging.example.com"
$salonSetupToken = "YOUR_BOOTSTRAP_TOKEN"
Invoke-WebRequest -Method Post -Uri "$salonApiUrl/__setup" -Headers @{ Authorization = "Bearer $salonSetupToken" }
```

Setup requires a secret of at least 32 characters, accepts POST only and permanently closes after success for that database. Remove the `BOOTSTRAP_TOKEN` and `BRAND_OWNER_PASSWORD` deployment secrets after setup. Keep setup tokens out of frontend code.

7. Register a Stripe test webhook at `/api/v1/payments/stripe/webhook`, configure the payment-intent success/failure events used by the app and upload its signing secret. Exercise topups, appointment/deposit and group-purchase payment flows in Stripe test mode. Raw webhook parsing remains before JSON middleware; signature verification is asynchronous for Workers.
8. Run full frontend/API regression on staging. Check minute cron runs, expired holds, password-reset delivery, R2 CORS and upload confirmation. Review storage/CPU usage under expected concurrent traffic.

## Production cutover

### Brand email settings schema upgrade (v19)

`0019_brand_email_settings.sql` adds `BrandEmailSetting` with one setting per brand, cascading brand relations, nullable encrypted SMTP/OAuth credentials and disabled/unverified defaults. SQLite stores `EmailProvider` as text; generated Prisma enums contain all six providers. Existing brand/payment data and global SMTP settings are preserved. Deploying applies the schema once on Durable Object initialization.

The email-settings router is now mounted in `src/app.ts`. The provider implementation includes a Worker-specific SMTP socket adapter, Microsoft Graph OAuth, Resend DNS/domain verification and guarded custom SMTP on Node only. v20 adds the dormant outbox table; v21 adds provider configuration version/status metadata and invalidates old verification once while retaining encrypted credentials. No business-email scheduler or booking-email trigger is activated. See [the merchant email setup and Postman guide](../docs/merchant-email-provider-guide.md) for secrets, external setup, mock-test evidence and pending real-provider verification. Tests use synthetic credentials and do not send real emails.

### Historical payment order number backfill (v18)

`0018_backfill_payment_order_numbers.sql` is the Cloudflare equivalent of the Node/PostgreSQL `scripts/backfill-payment-order-numbers.ts` script. On first database initialization after deployment, it fills only NULL payment codes atomically with distinct six-character codes containing letters and digits, skipping existing codes. Existing codes, financial fields and relations remain unchanged. Future payments can still have NULL codes because the schema remains optional; this migration is a one-time backfill.

No separate backfill command is needed on Cloudflare. Run `npm run cloudflare:check`, `npm run test:cloudflare:migrations` and the database/API regressions, then deploy with `npm run cloudflare:deploy:staging` or `npm run cloudflare:deploy`. This does not execute the PostgreSQL backfill script.

### Payment order number upgrade (v17)

`0017_payment_order_number.sql` adds nullable, unique `Payment.orderNumber`. Historical payments keep null codes, amounts and relations; this migration does not generate payment order numbers. Existing appointment order numbers are unchanged. The build bundles v17 and it applies once on Durable Object initialization after deployment. A matching PostgreSQL migration is included for the Node runtime.

Validate using `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, `npm run test:cloudflare:database`, `npm run test:cloudflare:api` and `npm run test:book-now`. Then deploy with `npm run cloudflare:deploy:staging` or `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Required appointment order number upgrade (v16)

`0016_require_appointment_order_number.sql` backfills only NULL order numbers with distinct six-character codes, skipping codes already in use. It then rejects NULL inserts and updates using database triggers. This preserves the referenced Appointment table, payment/refund relationships, money triggers and existing indexes. SQLite's column metadata remains nullable; the schema checker verifies both trigger definitions before accepting their equivalent required-field enforcement. Prisma exposes the field as required.

Backfill and enforcement run atomically once on Durable Object initialization. No separate PostgreSQL backfill command is needed for Cloudflare. Existing non-null codes and other appointment fields remain unchanged. Do not run the Node/PostgreSQL backfill script against Cloudflare.

Verify with `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, `npm run test:cloudflare:database`, `npm run test:cloudflare:api` and `npm run test:book-now`. Then use `npm run cloudflare:deploy:staging` followed by `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Appointment order number schema upgrade (v15)

`0015_appointment_order_number.sql` adds nullable `Appointment.orderNumber` with a unique index. Historical appointments retain null order numbers; new bookings generate six-character codes. PostgreSQL `@db.VarChar(6)` becomes SQLite text during Cloudflare schema generation. Existing migrations remain unchanged and v15 applies once on Durable Object initialization after deployment.

Run `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations` and `npm run test:cloudflare:api` before deployment. Deploy staging with `npm run cloudflare:deploy:staging` and production with `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Staff portfolio schema upgrade (v14)

`0014_staff_portfolio.sql` adds `StaffPortfolioCase` and `StaffPortfolioCaseImage` with their indexes. Portfolio tags use JSON arrays and status uses text in SQLite. Deleting a service retains its portfolio cases with a null service reference; deleting staff removes its cases and images. Existing migrations remain unchanged, and pending v14 applies once on Durable Object initialization after deployment.

Validate with `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, and `npm run test:cloudflare:database`. Then deploy staging with `npm run cloudflare:deploy:staging` and production with `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Banner schema upgrade (v13)

`0013_banner_management.sql` adds `Banner`, `BannerBranch` and `BannerMedia`, including indexes and cascading foreign keys. The Cloudflare build generates the Prisma client and bundles this migration; each existing Durable Object applies it once on initialization, preserving existing records. PostgreSQL migrations under `prisma/migrations` are not used by this runtime.

Before deploying this schema change, run:

```powershell
npm run typecheck
npm run cloudflare:check
npm run test:cloudflare:migrations
npm run test:cloudflare:api
```

Deploy staging with `npm run cloudflare:deploy:staging`, then production with `npm run cloudflare:deploy`. Existing secrets and the `salon-v1` database identity must be retained. Banner JPEG/MP4 uploads use the existing R2 credentials and bucket CORS configuration.

The default Worker is `hair-salon-backend`; staging has a separate Worker and Durable Object namespace. Prepare `.cloudflare-secrets.production.json` with production settings and separate R2 storage, then:

```powershell
npm run cloudflare:check
npx wrangler secret bulk .cloudflare-secrets.production.json
npm run cloudflare:deploy
```

Repeat domain, setup, webhook and delivery checks for production. If existing PostgreSQL data must be retained, **do not switch traffic yet**: these scripts do not import existing records or Redis sessions. Back up and rehearse a separately verified import preserving IDs, relations, timestamps, Decimal-to-hundredth conversion, arrays and financial totals. Sessions need migration or a deliberate fresh login. Keep the old backend available until cutover validation completes.

The initial SQLite migration is immutable after deployment. Build-time schema drift checks and runtime checksums reject incompatible versions. Versioned SQL is bundled by build-cloudflare.mjs and checked against the generated schema by applying all versions to disposable SQLite. Runtime checks every applied checksum before running pending versions. `npm run test:cloudflare:migrations` verifies a populated v1/v2-to-v3 upgrade, repeated initialization, foreign keys and checksum rejection. Future changes require registering new versioned SQL in the build/schema check and testing upgrades on populated data; do not overwrite `0001_initial.sql`, delete the Durable Object migration, rename its class or change its singleton name to bypass a mismatch. Configure database backups/recovery before accepting live financial traffic.

References: [Express on Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/), [Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Email sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
