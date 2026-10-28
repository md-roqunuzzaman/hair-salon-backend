# Transactional email implementation

## Audit: authoritative event sources

This mapping was recorded before integrating business email. Existing notifications and financial calculations remain authoritative; email hooks only insert records in the same transaction. No transport runs in those transactions.

| Event | Authoritative source and state | Identity |
| --- | --- | --- |
| PAY_NOW confirmed | `payment.service.ts` normal active-hold Stripe settlement; `wallet.service.ts` guarded wallet appointment settlement. CONFIRMED/PAID only, excluding group-purchase appointments | appointment ID |
| RESERVE_NOW reserved | `appointment.service.ts` reservation creation; `group-purchase.service.ts` direct-book RESERVE_NOW appointment creation. RESERVED only | appointment ID |
| Deposit received | `payment.service.ts` normal active-hold appointment deposit settlement, RESERVED/PARTIALLY_PAID; group deposits use the group-purchase event instead | appointment ID |
| Group purchase successful | `payment.service.ts` initial Stripe settlement and `wallet.service.ts` initial wallet settlement. Paid or deposit-partially-paid purchase with settled payment; unpaid direct-book RESERVE_NOW becomes successful at its first paid salon settlement in `group-purchase.service.ts` | purchase ID |
| Booking cancelled | Legacy `appointment.service.ts` cancellation and policy `cancellation-refund.service.ts` guarded cancellation | appointment ID |
| Booking rescheduled | `appointment.service.ts` successful update inside reschedule transaction; no-op date/time/staff repeats are excluded | new operation UUID persisted in outbox; prior/new schedule in snapshot |
| Refund completed | `payment.service.ts` late appointment/group Stripe finalization and direct wallet refund; `refund-request.processing.ts` approved Stripe/wallet completion | actual successful Refund ID |

QR verification, voucher redemption, remaining payment after an already successful purchase, completion, top-up, failed payments/refunds and reminders do not create email events. Existing platform OTP/password reset remains separate.

## Release boundary

Implementation and mock verification are local. This task prepares deployment artifacts; it does not authorize a production deployment, business-email scheduler activation, or real customer email. Live merchant tests and inbox confirmation remain separate. `EMAIL_OUTBOX_ENABLED` must stay absent/false until separately approved.

The live frontend staging API must remain online. Do not deploy the maintenance Worker to complete email development or testing. The restored live version/database and HTTP evidence are documented in [staging-api-restoration-report.md](staging-api-restoration-report.md). All implementation checks below use disposable local databases and mocked delivery.

## Transaction and delivery architecture

All seven events resolve the customer through the business record and insert the existing EmailOutbox row inside the existing Prisma transaction. A rollback removes both changes. Only the processor performs network delivery, after commit. Missing/invalid recipient or an ambiguous single-brand context skips enqueueing without failing the booking. Storage failures still obey the existing atomic transaction; they are not silently converted into a committed business change with a lost email event.

Keys are `<brandId>:<eventType>:<businessRecordId>`. Reschedules add a persisted operation UUID: the same target date/time/staff is a no-op for email; each genuinely committed subsequent schedule change has a distinct key. Serializable business transactions and existing guarded updates remain in place. There is no exactly-once network-delivery claim.

```mermaid
stateDiagram-v2
    PENDING --> PROCESSING: atomic claim with token and lease
    PROCESSING --> SENDING: token and unexpired lease match
    PROCESSING --> PENDING: abandoned before send
    SENDING --> SENT: provider accepted and fenced save succeeded
    SENDING --> PENDING: definite transient rejection before acceptance
    SENDING --> FAILED: permanent rejection or attempts exhausted
    SENDING --> DELIVERY_UNCERTAIN: ambiguous response or abandoned send
```

Claiming uses an atomic conditional update on ID, PENDING state, attempt count, due time and lock expiry. A random claim token fences every subsequent state write; stale workers cannot complete or release another worker's job. The lease is five minutes. Recovery distinguishes PROCESSING (no send started) from SENDING (possibly submitted): only the former is reclaimed automatically. A crash after SENDING is recorded but before actual I/O may therefore conservatively require manual inspection.

Up to three attempts are allowed, with 2/4-minute backoff for the first two failures (delay capped at 60 minutes). SMTP 4xx rejections and definite connection/TLS failures can retry. SMTP 5xx recipient rejection, authorization/configuration failures and HTTP client rejection are permanent. Submission timeout, ambiguous provider response, or accepted-send persistence failure is DELIVERY_UNCERTAIN, never an automatic retry. If even the uncertainty write fails, the stale SENDING lease is later quarantined. The processor records provider, message ID where supplied, attemptedAt, sentAt, attempts and canonical error code. SENT means provider acceptance, **not inbox delivery**.

Initial provider selection uses current enabled/verified/runtime-ready merchant settings, otherwise platform SMTP. A merchant attempt never falls back to platform after failure, including later queued retries: once an attempt records a provider, a subsequent change to another provider/platform fails with EMAIL_RETRY_PROVIDER_CHANGED for operator review. Unattempted queued jobs resolve current provider settings at processing time. The resolver rechecks the repository's exactly-one-brand invariant; an unknown brand cannot silently use platform SMTP. OTP/password-reset imports and transport remain platform-only.

## Templates and recipient isolation

`brand-email-setting.templates.ts` produces responsive HTML tables plus plain text for en, zh-CN and zh-HK. It uses existing preferredLanguage/default-language conventions and localized item snapshots, escapes dynamic HTML, formats currency through Intl, and labels stored appointment calendar dates/times as Asia/Hong_Kong. SMTP/Resend receive both alternatives. Microsoft Graph receives base64 MIME with both parts when both exist, using the documented [Graph sendMail MIME contract](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

Deposit receipts use the actual successful deposit Payment amount and stored appointment remainingAmount. Group receipts use the settled Payment (or first successful salon Payment for an initially unpaid Reserve Now purchase), stored total/remaining amount, quantity and supported package validity. No voucher code or redemption promise is invented. Refund receipts use the distinct SUCCEEDED Refund record and verify that payment, appointment/purchase and customer relationships agree. QR tokens, provider credentials, raw payment data and message bodies are excluded from operational logs and the inspection API.

## Scheduler and operations

Workers reuse the existing minute cron and Durable Object request queue; no second Cloudflare scheduler was created. The outbox batch is capped at two jobs per Worker tick and errors are isolated from existing maintenance jobs. Node uses `email-outbox.job.ts`, prevents overlapping local ticks, and caps a batch at ten; database fences coordinate multiple Node processes.

Both processing entry points require the exact string `EMAIL_OUTBOX_ENABLED=true`. It defaults to false in `.env.example` and both Wrangler environments. Event enqueueing remains durable while delivery is off. **Review the accumulated backlog before separately approving activation.** No live flag or cron schedule was changed during implementation.

Owner-only `GET /api/v1/brand-email-settings/:brandId/outbox` returns the latest 100 jobs' metadata, including pending/failed/uncertain states. It excludes recipient, subject/body, OAuth/encrypted credentials and claim tokens; legacy error prose is replaced by a canonical legacy-failure marker. The endpoint cannot retry or send a job. The Postman collection includes this read-only request; do not run the complete collection as a delivery runner.

Monitor FAILED, DELIVERY_UNCERTAIN, old PENDING jobs, expired leases, attempt counts and safe EMAIL_JOB_STORAGE_FAILED/EMAIL_BATCH_STORAGE_FAILED codes. Investigate uncertain jobs with provider logs and the designated user's inbox before deciding whether any resend is appropriate. There is deliberately no automatic uncertain-job replay or retry endpoint. Message content is stored in the outbox for asynchronous delivery; apply database access controls and an owner-approved retention policy. This task does not delete historical rows automatically.

## Schema and file map

v19/v20/v21 remain immutable. New additive SQLite `0022_email_outbox_delivery_fence.sql` and PostgreSQL `20261028090000_email_outbox_delivery_fence/migration.sql` add nullable claimToken, attemptedAt and text. Old PROCESSING jobs and previously attempted PENDING jobs are quarantined as DELIVERY_UNCERTAIN once, without changing unattempted PENDING or historical SENT records. Existing credentials/bookings/payments/refunds remain intact. v21's verification reset is still one-time.

Files added or extended for this transactional task (paths relative to repository root):

- `src/app/module/brand-email-setting/brand-email-setting.events.ts`, `.templates.ts`, `.outbox.ts`, `.outbox-processor.ts`, `.sender.ts`, `.route.ts`, `.errors.ts`, `.http.ts`, `.microsoft.ts`, `.test.ts` (each abbreviated suffix uses the `brand-email-setting` prefix).
- `src/app/module/appointment/appointment.service.ts`, `src/app/module/cancellation-refund/cancellation-refund.service.ts`, `src/app/module/group-purchase/group-purchase.service.ts`, `src/app/module/payment/payment.service.ts`, `src/app/module/refund-request/refund-request.processing.ts`, `src/app/module/wallet/wallet.service.ts`: transaction-local hooks only; financial calculations, eligibility, state transitions and existing notification payloads remain authoritative.
- `src/app/jobs/email-outbox.job.ts`, `src/server.ts`, `cloudflare/worker.mjs`, `wrangler.jsonc`, `.env.example`: disabled-by-default scheduler integration.
- `prisma/schema/brandEmailSetting.prisma`, both v22 migration paths above, generated `cloudflare/prisma/schema.prisma` and `cloudflare/runtime/model-metadata.json`; `scripts/build-cloudflare.mjs`, `scripts/check-cloudflare-schema.mjs`, `scripts/test-cloudflare-migrations.mjs`: schema/build parity.
- `cloudflare/business-email.integration.test.mjs`, `cloudflare/runtime/business-email-fixture.mjs`, `cloudflare/runtime/email-test-fixture.mjs`, `cloudflare/runtime/integration-fixture.mjs`, `cloudflare/test-support/public-worker.mjs`, `cloudflare/book-now.integration.test.mjs`, `cloudflare/merchant-policy.integration.test.mjs`, `cloudflare/email-provider.integration.test.mjs`, `cloudflare/runtime/database-fixture.mjs`, `cloudflare/runtime/migration-fixture.mjs`, `cloudflare/runtime/smtp.mjs`, `package.json`: transport, migration, security and event evidence.
- `docs/merchant-email.postman_collection.json`, `docs/merchant-email-provider-guide.md`, this guide and `cloudflare/README.md`: manual workflow and release evidence. The complete earlier provider implementation map remains in the provider guide.
- `scripts/inventory-routes.mjs`: two user-approved pre-existing contract changes are checked explicitly while the historical baseline remains immutable: staff detail retains OWNER/MANAGER/STAFF/CUSTOMER access, and the manual appointment-complete route remains absent in favor of the existing completion job. No staff/appointment route implementation was changed for these decisions. Every other historical middleware/controller contract remains strict.

## Environment and deployment checks

New delivery activation setting: `EMAIL_OUTBOX_ENABLED=false`. Provider prerequisites remain `EMAIL_ENCRYPTION_KEY` (existing persistent 64-hex-character key), platform SMTP_HOST/PORT/USER/PASSWORD/EMAIL_SENDER, and optional Microsoft client ID/client secret/tenant/redirect URI for Microsoft use. Resend needs domain-management permission and a verified exact sender domain. QQ/163 need provider authorization codes. Arbitrary custom SMTP remains Node-only. No new secret is required merely to build this inactive feature.

Staging release checklist, to be executed only after separate deployment approval:

1. Keep the currently working staging API online. Do not deploy maintenance as part of email development. Confirm the active version and existing namespace/singleton; never rename/recreate them.
2. Verify a current usable backup/PITR recovery point through an approved non-disruptive process. The saved v19 backup is a tested rehearsal input, not a claim that it includes changes made later by frontend developers.
3. Recheck the live ledger against the candidate's immutable history. v20/v21/v22 are pending only when the live database is still v19. Never run PostgreSQL migrations against the Worker database.
4. Keep EMAIL_OUTBOX_ENABLED false; retain existing secret values and review cron configuration. A normal Wrangler deploy would reinstate the pre-existing minute cron from configuration; that is separate from activating email delivery.
5. Run the existing staging check/dry-run, then deploy the prepared application with `npm run cloudflare:deploy:staging` only after approval. Its Durable Object initializes pending versioned migrations; do not separately reset or seed the database.
6. Probe `/` health, public catalog endpoints, valid frontend auth and credentialed CORS. `/api/v1` itself has no health handler and returns 404; authenticated lists can return 401 without a token.
7. Read merchant configuration/outbox metadata with valid owner access. Old merchant configuration stays disabled/unverified after v21 until an explicit retest/enable. No automatic enable occurs.
8. The user can manually test only the approved direct `/test-email` endpoint. Recipient: khanrokon571@gmail.com; sequential maximum one attempt per available provider, no automatic retry. Missing consent/credentials/domain readiness stays pending. Confirm inbox separately.
9. Keep live business delivery disabled until safe mock staging fixtures, provider sign-off, backlog review and explicit activation approval are complete. Do not create production bookings/charges or send real customer emails as a smoke test.

Production checklist: all relevant automated checks and documented regression issues resolved; staging behavior and real provider/inbox sign-off recorded; correct production secrets and OAuth/domain setup; current backup and rehearsed recovery; compatible application artifact retained; explicit production-deployment approval; separate scheduler/backlog activation approval and monitoring ownership. Production has not been deployed by this task.

For a separately approved Node/PostgreSQL rollout, validate the correct direct migration connection and backup first, then apply versioned migrations with `npx prisma migrate deploy --config prisma.config.ts` before starting the new server. This command is documentation only; no PostgreSQL migration was executed during this task. Prisma schema validation and the real SQLite migration/upgrade tests do not certify a live PostgreSQL upgrade.

## Rollback and recovery

Do not reset the database or edit `_Migrations`. Once v22 is applied, the restored historical v19 application version is **not** a valid automatic rollback: its migration checker rejects extra versions. Keep an application artifact that understands the v22 ledger/schema with EMAIL_OUTBOX_ENABLED=false, or forward-fix using a schema-compatible version. Disable outbox processing before investigating a delivery incident; do not clear SENDING/DELIVERY_UNCERTAIN records for replay. Database/PITR restoration is a separately approved recovery operation because it can discard newer frontend/customer writes. Preserve encrypted credentials and the matching encryption key.

## External verification and status

The frontend's staging API remains the restored v19 application. This candidate is local; real delivery, the new candidate's staging deployment and production activation are distinct uncompleted release gates. Microsoft tenant setup and Resend DNS readiness cannot be certified by mocks. No real test email was sent during this implementation. Final automated evidence follows.

The Worker currently serializes cron processing and HTTP requests through its existing Durable Object queue. Once separately enabled, a two-message email batch can add bounded SMTP/API wait time to queued requests; verify that latency under staging load before live activation. With EMAIL_OUTBOX_ENABLED=false, there is no business-email network wait in cron. The live restored staging worker's cron triggers remain paused; completion-job implementation is preserved, not newly activated.

## Final validation — 2026-10-28

`npm run test:regression` completed with exit code 0: **220 TAP tests passed, zero failed/skipped**, plus database adapter, migration, schema-drift and route-inventory assertions. An earlier run exposed the old route baseline mismatches; the two exact user-approved contract decisions above resolved those checks without changing application routes or rewriting the historical baseline.

| Check | Result |
| --- | --- |
| TypeScript typecheck and Node production compilation | Passed |
| PostgreSQL Prisma schema validation | Passed; no live PostgreSQL migration executed |
| Error handling / auth / SMTP / database retry | 38 / 8 / 5 / 4 TAP tests passed |
| Booking / in-app notifications / refund safety / financial proof | 24 / 8 / 22 / 12 TAP tests passed |
| Merchant provider Node/security/template tests | 6 passed |
| Mocked Worker merchant/OAuth/domain integration | 4 passed; includes full provider workflows |
| Transactional Worker outbox/event/localization integration | 6 passed; includes many workflow assertions within each test |
| Existing Worker API / remaining payment | 6 passed |
| Book Now / policy calculation / policy API | 19 / 34 / 24 passed |
| Fresh SQLite schema drift and upgrade through v22 | Passed |
| Captured v19 staging backup local restore and v22 upgrade | Passed; 13,319 existing cells preserved; repeated initialization passed |
| Historical route contracts | 148 checked; exactly one approved role update and one approved retirement; no method/path collisions |
| `npm run cloudflare:check` | Passed; dry-run only |
| `npm run cloudflare:check:staging` | Passed; dry-run only |
| Final Worker dry-run upload size | 7421.85 KiB; gzip 2043.58 KiB |
| Production bundle isolation | Test fixtures and native Node merchant SMTP excluded; event/templates/fenced processor included |
| Postman collection | Valid JSON; 16 manual requests, including read-only outbox inspection |
| Whitespace/diff check | Passed |

The policy tests now check actual existing safeguards: deposits refund only their successful original funding record before check-in; checked-in cancellation is blocked; ordinary wallet checkout rejects a DEPOSIT hold without changing financial records. No eligibility/refund/wallet calculation was changed to obtain a passing test.

Additional coverage includes duplicate signed webhooks, a repeated reschedule target, legitimate later reschedules, rollback removing an email event, failed/pending refunds producing no receipt, cross-customer refund rejection, invalid recipients, unknown brands, unapproved event rejection, atomic concurrent claims, exhausted retry budget, transient/permanent SMTP rejection, abandoned pre-send/send leases, stale sender fencing, accepted-send persistence failure, provider changes before first attempt, and **no platform fallback on a later retry of an already attempted merchant job**. All external email and Stripe operations are mocked in these tests.

Build evidence is stored in ignored `cloudflare/.build/email-release-manifest.json`: current artifact hashes, 22 migration checksums, false delivery flags, test counts and bundle-isolation assertions. Detailed local logs are under `node_modules/.cloudflare-test/transactional-email-final-verified.log`, `email-release-production-dry-run.log` and `email-release-staging-dry-run.log`. No secret values are exported in the manifest or this documentation.

Read-only live availability verification at `2026-10-28T07:48:00.912Z`: application version `7d7feaa2-f1bb-4be5-99d4-3b585e40bd14` retained 100% staging traffic; `/`, `/api/v1/branches` and `/api/v1/services` returned 200; cron count remained 0. No staging mutation was performed while completing this implementation. Review-module edits present in the shared workspace were preserved; this task adds no review email event.

| Readiness status | Current outcome |
| --- | --- |
| Implementation complete | Yes, for the seven approved business events and reused provider/outbox architecture |
| Automated verification | Passed, including full regression and both dry-runs |
| Candidate ready for separately approved staging rollout with delivery disabled | Yes, subject to current release-time backup/configuration checks |
| Existing frontend staging API available | Yes; restored application kept online |
| New email candidate staging verified | Pending deployment and owner/API/provider sign-off |
| Live transactional delivery / scheduler activated | No |
| Production email activation sign-off | Pending real provider/inbox verification and operational release gates |
| Production deployed | No |
