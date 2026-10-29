# Unified merchant email — local v26 candidate

## Enabled-by-default configuration update — v26 local candidate

Backend-only implementation, 2026-10-29. This update is **not deployed**. It does not change the previously approved live staging outbox flag, production settings, secrets, queued jobs or delivery history. Frontend is in a separate repository and was explicitly excluded from this task.

New BrandEmailSetting rows default to `isEnabled=true`, `isVerified=false` in Prisma, SQL and the save service. Enabled records are still blocked from normal sending until verified and runtime/provider-ready; the business processor additionally requires EMAIL_OUTBOX_ENABLED=true. Direct owner configuration tests remain the deliberate verification exception. A successful test of a new enabled SMTP setting returns `isEnabled:true`, `isVerified:true`, `sendingStatus:"READY"`; no separate Enable click is required. Provider acceptance is not proof of inbox receipt.

| Operation | Enabled choice | Verification |
| --- | --- | --- |
| Create new configuration | true | false |
| Successful SMTP test | Preserved | true when provider/runtime-ready |
| Failed SMTP test | Preserved | false; safe error recorded |
| Cosmetic fromName edit | Preserved | Preserved, including test timestamp/provider metadata |
| Resubmit identical normalized credential | Preserved | Preserved |
| Change provider, credential, fromEmail, SMTP identity/host/port/TLS | Preserved | Reset; new test required |
| Explicit owner Disable | false | Preserved |
| Edit/test an already disabled setting | Remains false | Updated only by verification rules |
| Explicit owner Enable after successful verification | true | Existing verified/readiness requirements retained |

The SMTP path supports Gmail, QQ, NetEase 163 and Node Custom SMTP. Custom SMTP remains unsupported on Workers; testing it there fails closed and does not change enabled intent. The same owner-intent separation is retained in existing Resend domain and Microsoft OAuth flows: readiness/auth failures invalidate verification without silently changing enabled preference. Explicit Microsoft disconnect still disables the configuration as an owner action. All routing continues to require enabled AND verified AND existing provider/runtime readiness, with no platform fallback.

API contracts remain compatible: PUT still accepts provider configuration fields, not isEnabled/isVerified. Sending status cannot be forged through the save payload; use the existing PATCH /enable and /disable controls. GET adds `defaults:{isEnabled:true,isVerified:false}` for clients initializing a new form. Existing `setting` values always take precedence over defaults. Test-email adds isEnabled and sendingStatus to its existing safe response. Frontend handoff: initialize a genuinely new form from defaults, load saved values for existing settings, and do not send status fields in PUT. No frontend files were changed.

Existing merchants are **never bulk-enabled**. A merchant currently disabled remains disabled after migration, edits and successful tests, until its owner explicitly enables it. Preserve existing credentials and encryption key. No new environment variable is required and this task does not modify EMAIL_OUTBOX_ENABLED in either environment.

New migrations: `cloudflare/migrations/0026_email_enabled_default.sql` and `prisma/migrations/20261029100000_email_enabled_default/migration.sql`. PostgreSQL changes only the column DEFAULT inside BEGIN/COMMIT. SQLite transactionally rebuilds BrandEmailSetting with its parent foreign key and unique brand index, explicitly copies every existing field, then swaps tables. No other table references BrandEmailSetting. The normal migration ledger makes initialization repeatable. Do not run raw migration SQL repeatedly or edit v1-v25 history. Tests inject failure after the copy/swap and require data/default/ledger rollback, then assert exact preservation of disabled, enabled, verified and unverified existing rows, encrypted values, timestamps, indexes and foreign-key constraints. Historical outbox/history rows are untouched.

On a separately approved Worker rollout, keep the same namespace/singleton and verify a current usable backup before initialization applies pending v26. Do not run PostgreSQL migrations against Workers. A v25 binary cannot be used as an automatic rollback after v26 because it rejects the extra ledger version; retain a v26-compatible recovery artifact. For a separately approved Node/PostgreSQL rollout, rehearse and apply the pending Prisma migration against the correct backed-up database before server startup. No migration or deployment command was run against a live database in this task.

Because live staging outbox delivery was previously approved and enabled, verifying a newly enabled configuration after a future rollout can allow eligible business jobs to send on the next scheduled tick. Audit the then-current backlog before real provider verification. Existing failed/skipped/uncertain jobs are not automatically replayed by this change. Local tests use mocks exclusively.

### v26 verification and changed files

| Check | Result |
| --- | --- |
| `npm run test:regression` | 270 passed, 0 failed/skipped; exit 0 |
| Node merchant tests | 13 passed, including four real Node service/adapter lifecycles with mocked storage, DNS and SMTP |
| Worker merchant/auth/default tests | 16 passed, including independent new Gmail/QQ/163 configurations and Custom SMTP runtime rejection |
| Business email/event regressions | 7 passed; existing outbox/lease/idempotency protection retained |
| TypeScript and final Node build | Passed |
| PostgreSQL Prisma validation | Passed; live PostgreSQL migration not executed |
| `npm run cloudflare:prepare:staging` | Passed; local build/parity/migration/artifact checks only, exit 0 |
| Populated SQLite v25 -> v26 | Existing rows preserved exactly; enabled/disabled/verified/unverified choices retained; default-only upgrade and injected-failure rollback passed |
| Local historical backup restore/upgrade through v26 | Passed integrity/repeat checks; 13,319 original cells preserved |
| Immutable history | 91 historical SQL files match HEAD; prior release manifest also protects applied v1-v25 checksums |
| Worker bundle isolation | Passed; JS 3,534,369 bytes, native Node SMTP/test fixtures excluded |
| Historical route checks | 148 contracts with the two previously approved exceptions; no collisions |

Changed for this defaults task: `src/app/module/brand-email-setting/brand-email-setting.service.ts`, `.validation.ts`, `.test-email.ts`, `.sender.ts`, `.microsoft.ts`, `.domain.ts` (all abbreviated suffixes use the brand-email-setting prefix); `prisma/schema/brandEmailSetting.prisma`; the two v26 migrations; generated `cloudflare/prisma/schema.prisma` and `cloudflare/runtime/model-metadata.json`; `scripts/build-cloudflare.mjs`, `check-cloudflare-schema.mjs`, `test-cloudflare-migrations.mjs`, `verify-unified-email-release.mjs`; `cloudflare/runtime/database-fixture.mjs`, `migration-fixture.mjs`, `email-test-fixture.mjs`; `cloudflare/email-provider.integration.test.mjs`; new `cloudflare/email-defaults.integration.test.mjs` and `src/app/module/brand-email-setting/brand-email-setting.defaults.test.ts`; `package.json`; provider/current deployment guides. Booking, wallet, payment, financial event discovery, outbox processing and authentication routes were not edited by this defaults task. Earlier file maps below describe earlier work.

Current evidence is ignored under `node_modules/.cloudflare-test/email-default-regression.log`, `email-default-regression.exit.txt`, `email-default-cloudflare-prepare.log`, `email-default-cloudflare-prepare.exit.txt`, `email-default-provider.log`, `email-default-migrations.log`, `email-default-backup-rehearsal.log`; the refreshed manifest remains `cloudflare/.build/unified-merchant-email-release-manifest.json`. These checks do not certify live provider acceptance/inbox receipt, live backlog safety or a running PostgreSQL upgrade. No real SMTP, deployment, live database change or secret rotation was performed for v26.

## Subsequent approved staging activation — 2026-10-29

This update supersedes the earlier false-flag/no-activation status below **for staging only**. The user explicitly approved delivery to the pending masked recipient `s***@gmail.com` and future eligible staging business emails. At 12:57:28 Asia/Shanghai (04:57:28 UTC), the existing saved version `c8b11504-78db-4acc-b1e0-811001f7a8aa` was activated at 100% staging traffic, replacing `f08b47ff-227a-49c4-bf38-ce888d7b8873`. Its only verified binding difference is `EMAIL_OUTBOX_ENABLED=true`; deployed code ETag, other exposed binding metadata, runtime settings, namespace and minute cron match. No local application bundle was uploaded and no manual database migration, provider test or retry was invoked. Production was not modified.

Checked-in Wrangler staging now retains true to avoid accidentally disabling it on the next staging release; production remains false. The local artifact verifier permits either staging boolean, records its actual configured value, and still requires production false. Existing secrets were inherited, never read as plaintext, overwritten or rotated. Protected activation receipt: `.maintenance-backups/email-activation-20261029/activation-receipt.json`.

Merchant enablement was not modified by this flag activation. The latest supplied provider test verified Gmail but does not enable it. An owner must check merchant `isEnabled` separately. Jobs attempted while merchant delivery is disabled can fail with EMAIL_DISABLED; inspect their current status before deciding on further action. No automatic replay of failed/skipped/uncertain history was authorized or performed. Provider acceptance/inbox receipt and current job outcomes are not certified by the Cloudflare flag check.

Updated 2026-10-29. This document supersedes the earlier platform-OTP separation and v24 business-email retirement product policies. Local implementation and mocked verification are authorized. Deployment, live migrations, secret changes, delivery activation and real emails are not authorized.

## Tenant boundary and audit

The owner confirmed one brand per deployment/database. User has no brand-membership relation and Branch has no brand-owner relation; existing owner email/OAuth APIs also enforce exactly one brand. `resolveEmailBrand()` requires exactly one Brand and checks any supplied brandId against it. Recipient email never selects a tenant. Zero/multiple brands and a mismatched explicit brand fail closed. This is not a multi-tenant implementation; a future shared-database design requires real ownership/membership relations before deployment.

Reused: encrypted provider credentials, owner access/rate limits, SMTP adapters, Resend REST/domain verification, Microsoft OAuth/Graph, existing localized templates, outbox/history tables, lease fencing and single Durable Object queue. Added: merchant-only routing for authentication, independently reconciled business events and additive v25 storage. AUTO selection, financial calculations, QR, existing in-app notification payloads, business routes and response contracts remain authoritative.

## Central routing

`brand-email-setting.sender.ts` owns resolution and delivery. Normal sends require a configured, enabled, verified, runtime-ready merchant provider. The resolver checks configurationVersion again before network I/O. No failure uses platform SMTP, even for security emails or later retries. Legacy Node/Worker `transporter` adapters delegate to this resolver; platform SMTP environment values are unused for delivery.

| State | Internal non-send code |
| --- | --- |
| No setting | EMAIL_NOT_CONFIGURED |
| Disabled | EMAIL_DISABLED |
| Enabled but unverified | EMAIL_NOT_VERIFIED |
| Unsupported/not ready | EMAIL_PROVIDER_NOT_READY |
| Wrong/ambiguous deployment brand | EMAIL_BRAND_CONTEXT_INVALID |
| Configuration edited before send | EMAIL_CONFIGURATION_CHANGED |
| Attempted job resolves to another provider | EMAIL_RETRY_PROVIDER_CHANGED |

Disabled takes precedence when both disabled and unverified. Owner `GET /api/v1/brand-email-settings/:brandId` adds `sendingStatus` while retaining existing metadata fields. A legacy `configurationMode: PLATFORM_DEFAULT` value for an absent setting is compatibility metadata only and never permits platform delivery.

The existing owner-only `POST /:brandId/test-email` remains the explicit configuration-verification exception to enabled/verified checks. It uses the configured merchant provider, retains OAuth/domain/runtime requirements and may verify only the same configuration version. It does not automatically enable settings. Provider acceptance is not inbox confirmation. Never use it for customer booking notifications or run the Postman collection as a batch.

## Authentication

Existing password-reset OTP and reset-success are the only implemented authentication email flows; no new verification/login OTP flow was invented. Both call `sendMerchantSecurityEmail()` and use the strict merchant resolver independently of EMAIL_OUTBOX_ENABLED.

Forgot-password retains the response envelope and uses a generic public message for absent/inactive accounts, wrong/ambiguous brand and provider/configuration failures. It never says an OTP was sent. Optional brandId is backward-compatible and must match the deployment brand. Rate limits and Redis keys are brand-scoped: five requests per 15 minutes, atomic 60-second resend cooldown, five-minute OTP and five incorrect attempts. A newly generated OTP is stored only after provider acceptance. Reset tokens last ten minutes, are single-use and bind userId/brandId. Previously issued bare-user-ID tokens retain their existing bounded TTL compatibility. Existing password hashing and refresh-session invalidation remain unchanged.

Security delivery records contain recipient and safe metadata/history; OTP HTML, OTP value and reset credentials are never stored in EmailOutbox. Actual HTML exists only for the direct send. Definite failures are FAILED; ambiguous submissions/history persistence after acceptance are DELIVERY_UNCERTAIN. Security jobs are never automatically retried. Crashed expired SENDING security rows are quarantined by cron even while business delivery is false. A password already reset successfully stays reset if its confirmation email fails.

If merchant delivery is unavailable, an owner with a valid session can repair configuration through existing APIs. A locked-out owner must use an independently authenticated administrative recovery procedure with explicit approval; no unauthenticated recovery endpoint, fabricated token, account reset or hidden platform fallback was added. Do not casually replace EMAIL_ENCRYPTION_KEY. Merchant readiness is now a prerequisite for email-based account recovery and must be reviewed before rollout.

## Seven business events and commit isolation

Frontends continue calling existing business endpoints. They never enqueue email themselves. No provider network operation occurs inside booking/payment/refund transactions. Existing successful operations provide durable source records; an independent reconciliation transaction creates the job and initial history, then advances a cursor. Email storage/provider failures cannot roll back those already committed operations.

| Event | Committed source |
| --- | --- |
| RESERVE_NOW_RESERVED | New RESERVE_NOW Appointment.createdAt |
| PAY_NOW_CONFIRMED | Normal successful active-hold Stripe/Wallet appointment settlement sets emailPaymentConfirmedAt |
| DEPOSIT_RECEIVED | Normal successful appointment-deposit settlement sets the same marker; actual deposit Payment funds the receipt |
| GROUP_PURCHASE_SUCCESSFUL | Initial successful purchase settlement sets emailPurchaseConfirmedAt; initially unpaid Reserve Now purchase marks its first successful salon settlement |
| BOOKING_CANCELLED | Appointment.cancelledAt and CANCELLED state |
| BOOKING_RESCHEDULED | Existing customer notification stores internal previous/target emailIntent and a changed schedule revision; no-op repeats create no email intent |
| REFUND_COMPLETED | Actual SUCCEEDED Refund.refundedAt with matching business/customer relationships |

Late expired-hold settlements do not get confirmation markers. Group deposits use the group receipt, not a second appointment deposit receipt. Group receipts derive initial paid/remaining amounts from the original successful funding record, not a later remaining balance. QR checks, voucher redemption, remaining payments after an already successful purchase, completion, top-ups, reviews, failed payments/refunds, reminders and marketing create no new event type.

Each stream starts at its persistent v25 migration cutoff. No historical backfill is performed. Bounded scans use timestamp/id ordering, then repeat from the fixed cutoff after reaching the end. Repeated cycles catch transactions that commit after an earlier scan passed their timestamp. Stable `merchant-v1:<brand>:<event>:<record>` keys make scans/webhook/API retries idempotent. Reschedules use the persisted notification ID as operation identity. Cursor advancement, job and initial history are atomic together. A storage failure rolls back the independent collector transaction and leaves the source eligible for later discovery.

Six bounded streams process up to ten source rows each per tick by default. Repeated scanning can add discovery latency as source history grows; monitor and size this workload before live activation. This is durable reconciliation, not immediate email delivery on API success. Business responses do not claim email receipt.

## Eligibility, claims and retry protection

New reservation/reschedule snapshots must still match current appointment date/time/staff/revision, have RESERVED/CONFIRMED state and remain in the future in Asia/Hong_Kong. Changed/cancelled/past schedules become SKIPPED with EMAIL_BOOKING_OUTDATED. Valid historical payment/cancellation/refund receipts are not invalidated by a later schedule change.

Only approved new-generation jobs can be processed. Missing configuration records a terminal SKIPPED reason during discovery; configuring/enabling later does not revive that record. Existing v24 skipped, uncertain, failed and sent records remain unchanged. Old PENDING snapshots stay blocked and are not selected by the new-key batch processor.

Conditional claims, attempt counters, random claim tokens, five-minute leases and fenced transitions/history remain. PROCESSING before submission can be recovered after an abandoned lease. SENDING may have been submitted and becomes DELIVERY_UNCERTAIN. Accepted delivery whose final history cannot persist is also uncertain. Stale senders cannot overwrite another claim. No automatic resend of uncertain jobs or retry API exists.

Up to three attempts: definite connection/TLS failures and SMTP 4xx rejection use 2/4-minute backoff; SMTP 5xx/auth/configuration/client rejection fails permanently. HTTP rate limits can retry; ambiguous HTTP/send timeout/server responses stay uncertain. A provider is pinned once an attempt reaches SENDING; a later provider switch fails for owner review. No platform fallback occurs at any point. `safeEmailError()` retains explicit deliveryUncertain through TLS/SSL and other classification branches.

SENT means accepted by the provider, not delivered to an inbox. No exactly-once network delivery guarantee is claimed.

## Runtime and owner inspection

Node starts the existing minute scheduler with no-overlap protection. Workers use the existing minute Cron Trigger and scheduled handler, entering the same Durable Object queue as HTTP requests. Email is a separate task in runCronTasks; an unrelated failure does not prevent its execution, while aggregate cron failure reporting remains unchanged. Collector and crash quarantine run with delivery disabled. Business network sends require the exact string EMAIL_OUTBOX_ENABLED=true; both checked-in environments remain false. Authentication direct sends do not depend on that flag.

Owner APIs retain list data arrays/pagination, status/provider/event/recipient/date filters, detail, safe transition history, read-only audit and conditional pending-job skip. Authentication event filters are added. Responses redact body/subject/credentials/claim tokens, mask recipients and allow only canonical error codes. Uncertain jobs cannot be skipped/retried through the pending-only endpoint. Audit eligibility is business-record freshness, not a certification of provider readiness or inbox delivery.

| Provider | Node | Workers | External requirement |
| --- | --- | --- | --- |
| Gmail | Nodemailer TLS | cloudflare:sockets TLS 465 | App Password, matching sender, approved remote test |
| QQ | TLS | TLS 465 | SMTP authorization code |
| NetEase 163 | TLS | TLS 465 | SMTP authorization code |
| Resend | REST | REST | Verified exact sender domain with sending enabled |
| Microsoft 365 | OAuth/Graph | OAuth/Graph | Entra app, consent, matching sender identity |
| Custom SMTP | Vetted/pinned public IPv4, TLS/STARTTLS | Unsupported; fails closed | Owner-controlled Node deployment |

## Additive migration and recovery

SQLite `0025_unified_merchant_email.sql` and PostgreSQL `20261029090000_unified_merchant_email/migration.sql` add Notification.emailIntent, Appointment.emailPaymentConfirmedAt, GroupPurchase.emailPurchaseConfirmedAt and EmailEventCursor with six cutoff rows. No table/history/credential removal, old-event reactivation or v1-v24 edit occurs. SQLite uses the existing transactionSync wrapper with ledger insert; PostgreSQL uses explicit BEGIN/COMMIT. The normal migration ledger provides one-time application. Repeated initialization preserves cursor cutoffs/history. Do not execute additive SQL repeatedly outside its migration runner.

Migration tests inject a v25 failure after additive changes and prove all columns/ledger roll back, then verify successful upgrade and stable repeated initialization. Existing v24 retirement/uncertainty/history-preservation checks remain. PostgreSQL schema validation does not prove a real PostgreSQL upgrade; rehearse on an approved disposable PostgreSQL instance before its rollout.

After v25, an older v24 binary is not a valid automatic rollback: its immutable-ledger checker rejects the extra version. Retain a v25-compatible artifact with business delivery false for forward fix/recovery. Never edit _Migrations or restore an old backup without separate recovery approval; restoration can discard newer frontend/customer writes.

## Local checks and release gates

Reproducible Cloudflare staging preparation, with no deployment, provider send or remote migration:

```sh
npm run cloudflare:prepare:staging
```

This runs TypeScript validation, client/schema generation and parity checks, the production Worker build, disposable SQLite migration tests and the artifact/migration/false-flag verifier. It refreshes the ignored release manifest. It does not inspect live staging secrets, ledger or backup and does not replace the release-time gates below. Full business/provider regressions remain `npm run test:regression`.

Local verification commands: `npm run typecheck`, `npm run test:regression`, `npx prisma validate --config prisma.config.ts`, `node scripts/build-cloudflare.mjs`, `node scripts/build-cloudflare.mjs --test`. Regression includes Node compilation, mocked providers/auth/business events, real disposable Worker SQLite, financial/booking/policy tests, schema parity, upgrade atomicity and historical route contracts. Final counts are recorded below after completion. No wrangler deploy command, live migration, real provider request or email is part of these checks.

Before a separately approved staging rollout: verify current namespace/singleton/ledger and an up-to-date non-disruptive usable backup; keep frontend API online and both delivery flags false; preserve encryption/provider secrets; rehearse pending immutable upgrades; review owner recovery readiness. Worker initialization applies pending SQLite migrations. Never reset, seed or recreate staging, deploy maintenance, or run PostgreSQL migrations against Workers. Verify health, auth, owner sendingStatus/history and frontend contracts afterward. Deployment alone can route real user OTP/reset requests through enabled merchant settings even with business delivery false; review this intentionally changed behavior before approval.

Business activation is a separate approval after fresh backlog/provider/latency review. Historical skipped/uncertain records stay terminal. Real provider tests require separate approval and a designated recipient, one attempt per available provider without automatic retry. Verify inbox receipt separately. No test or deployment performed here certifies current remote credentials, OAuth consent, DNS, live backlog or inbox delivery.

## Changed file map

All paths below are repository-relative. No frontend repository was edited.

- Routing/security: `src/app/module/brand-email-setting/brand-email-setting.sender.ts`, new `brand-email-setting.auth.ts`, `brand-email-setting.service.ts`, `brand-email-setting.test-email.ts`; `src/app/lib/nodemailer.ts`; `cloudflare/runtime/nodemailer.mjs`, `env.mjs`, `sessions.mjs`; `src/app/module/auth/auth.service.ts`, `auth.controller.ts`, `auth.interface.ts`, `auth.validation.ts`.
- Event discovery and delivery: in `src/app/module/brand-email-setting/`, `brand-email-setting.events.ts`, `brand-email-setting.outbox.ts`, `brand-email-setting.outbox-processor.ts`, `brand-email-setting.outbox-validation.ts`, `brand-email-setting.outbox-history.ts`, `brand-email-setting.outbox-management.ts`; `src/app/jobs/email-outbox.job.ts`, `src/server.ts`, `cloudflare/worker.mjs`.
- Minimal committed source metadata: `src/app/module/appointment/appointment.service.ts`, `payment/payment.service.ts`, `wallet/wallet.service.ts`, `group-purchase/group-purchase.service.ts`; `notification/notification.interface.ts`, `notification/notification.service.ts`. The abbreviated paths after appointment are under the same `src/app/module/` directory. Financial and selection calculations were not changed.
- Schema: `prisma/schema/appointment.prisma`, `group-purchase.prisma`, `notification.prisma`, `brandEmailSetting.prisma`; both new v25 migration paths above; generated `cloudflare/prisma/schema.prisma`, `cloudflare/runtime/model-metadata.json`. Generated local Prisma clients/build artifacts remain ignored.
- Build/checks: `scripts/build-cloudflare.mjs`, `scripts/check-cloudflare-schema.mjs`, `scripts/test-cloudflare-migrations.mjs`, new `scripts/verify-unified-email-release.mjs`, `package.json`.
- Tests: new `cloudflare/auth-email.integration.test.mjs`; `cloudflare/business-email.integration.test.mjs`, `email-provider.integration.test.mjs`, `runtime.integration.test.mjs`, `book-now.integration.test.mjs`, `merchant-policy.integration.test.mjs`; `cloudflare/runtime/business-email-fixture.mjs`, `email-test-fixture.mjs`, `integration-fixture.mjs`, `migration-fixture.mjs`; `cloudflare/test-support/public-worker.mjs`; `src/app/module/brand-email-setting/brand-email-setting.test.ts`. Fixtures remain absent from the production entry.
- Documentation: this guide, `docs/merchant-email-provider-guide.md`, `docs/transactional-email-system.md`, `docs/merchant-email.postman_collection.json`, `cloudflare/README.md`, `.env.example` comments. No live `.env`, secret or Wrangler flag changed.

## Final local verification — 2026-10-29

| Check | Result |
| --- | --- |
| `npm run test:regression` | 260 TAP tests passed; 0 failed/skipped; npm exit 0 recorded |
| Final focused `npm run test:business-email` after storage-read recovery change | 7 passed; exit 0 |
| Merchant Node/security/template tests | 8 passed |
| Mocked Worker merchant/auth provider tests | 11 passed, including all existing provider workflows |
| Error/auth/SMTP/database retry | 38 / 8 / 5 / 4 passed |
| Booking/AUTO/in-app/refund/financial proof | 52 / 8 / 22 / 12 passed |
| Existing Worker API and remaining payment | 6 passed |
| Book Now / policy calculation / policy API | 21 / 34 / 24 passed |
| Final Node compilation and TypeScript no-emit | Passed |
| PostgreSQL Prisma schema validation | Passed; no PostgreSQL migration execution |
| Fresh SQLite schema parity and populated upgrade through v25 | Passed, including injected v25 failure rollback and repeat cutoff/history stability |
| Existing protected v19 backup restored/upgraded locally | Passed hash/integrity/foreign-key/repeat checks; 13,319 original cells preserved through v25 |
| Historical migrations | 91 SQLite/PostgreSQL SQL files match HEAD; none edited |
| Historical route contracts | 148 checked with the two previously approved exceptions; no method/path collisions |
| Production Worker build and source-map isolation | Passed; Worker JS 3,532,163 bytes, excluding separate compiler WASM |
| Delivery flags | Staging false, production false; source configuration unchanged |
| Diff whitespace | Passed |

Tests cover seven events, signed webhook replay, repeated scans, no-op reschedule, stale schedule skip, historical financial eligibility, rollback-isolated insert/read outages, provider readiness/redaction, SMTP 451 bounded retries, permanent rejection, concurrent claims, expired pre-send/send leases, stale sender fencing, accepted-send persistence failure, provider pinning, no platform fallback, owner inspection/skip controls, brand mismatch/ambiguity, generic public auth responses, OTP TTL/attempt/cooldown/window limits, reset-token replay and password-change preservation after confirmation failure. An injected unrelated cron failure still permits email processing while preserving aggregate error reporting; the test calls the Durable Object binding as the actual scheduled handler does.

MIME composition from Nodemailer is intentionally reused on Workers; its native Node SMTP connection/transport and merchant Node adapter are excluded. Worker fixed SMTP uses Cloudflare sockets; Resend/Graph remain REST. No unsupported custom Worker SMTP was added.

Ignored evidence: `node_modules/.cloudflare-test/unified-email-regression.log`, `unified-email-regression.exit.txt`, `unified-email-business.log`, `unified-email-providers.log`, `unified-email-backup-rehearsal.log`; `cloudflare/.build/unified-merchant-email-release-manifest.json` stores artifact hashes, v1-v25 checksums and isolation/false-flag assertions without secrets. The saved backup is historical rehearsal input, not a new live recovery point.

Local implementation/build readiness is complete. Staging deployment, current remote configuration/backlog verification, PostgreSQL upgrade rehearsal, real provider/inbox sign-off and production rollout remain separate gates. No deployment, live data modification, secret/environment change or real email was performed.
