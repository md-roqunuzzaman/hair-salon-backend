# Unified Group Purchase audit and recovery

The existing group-purchase services now use durable refund attempts and purchase settlement identity. Book Now public creation and Stripe intent creation now share ENABLE_BOOK_NOW_PURCHASE, defaulting to disabled. See BOOK-NOW-STAGING.md for the subsequent public API integration and opt-in testing guide. No production deployment, real charge/refund, environment change, data reset, or merchant cancellation-policy implementation was performed.

## Findings and fixes

| Finding | Resolution |
| --- | --- |
| A refund younger than 60 seconds could be submitted concurrently | Removed the age heuristic. Atomic database claim plus permanent `refundAttemptedAt` fence precedes the external call. |
| Stripe idempotency alone cannot protect an arbitrarily old retry | Durable attempt fence never authorizes another create after an unknown outcome, even after lease expiry. Stripe create uses one stable key and disables SDK network retries for that call. |
| A refund accepted by Stripe could lose its local provider ID | Reconcile by provider ID or at most three pages of PaymentIntent-filtered refund listings, matching persisted refund identity/metadata. No match or multiple matches requires investigation, not resubmission. |
| Missing PaymentIntent on a provider refund was tolerated | PaymentIntent, provider ID, amount and currency must match; null/mismatch blocks finalization. |
| Newly returned provider success was not fully verified | New and retrieved provider refunds use the same identity/amount/currency validation. |
| Pending approved Stripe refunds could not resume | Admin process retry reconciles an existing PROCESSING request; it never creates another refund. Signed group `refund.updated` events can also reconcile. |
| A late duplicate payment could make the original successful payment look refundable | `GroupPurchase.settledPaymentId` identifies the canonical initial payment. New settlement writes it atomically. Migration backfills only unambiguous legacy settlements. Ambiguous settlements fail closed. |
| Deposit success replay after salon remainder could refund a valid deposit | Replay follows canonical payment identity instead of comparing the purchase to its earlier PARTIALLY_PAID state. |
| Book Now code assumed exactly one linked appointment forever | Initial appointment is the unique linked appointment whose bookingMethod matches the purchase method. Redemption appointments use GROUP_PURCHASE, so additional redemptions do not invalidate initial identity. No extra appointment relation is needed. |
| Concurrent redemption and remaining-payment decisions needed explicit serialization | Purchase row locks inside existing Serializable transactions; Cloudflare preserves the same critical section through its DO queue/SQLite transaction facade. |
| Provider success must not leave partial local bookkeeping | Late refund finalization locks the payment and commits Refund, Payment, audit log, notification and webhook event in one transaction. Replays do not emit duplicate notifications. Approved refund finalization locks its request and is repeatable. |
| Raw Stripe verification error messages could appear in logs | Signature logs use a static error code and safe structural diagnostics. |
| Newly generated money triggers would change historical v1 checksum | v1 triggers are generated only for original columns. New GroupPurchase precision triggers are installed in v4. The v1 checksum was compared with committed pre-change metadata and matched. |

## Preserved rules and guards

- BUY_NOW_BOOK_LATER purchases reserve package quantity while payment is pending; settlement converts reserved to sold once. Full purchase payment is required for redemption.
- DIRECT_BOOK PAY_NOW confirms the initial appointment without a QR token. DEPOSIT charges the deposit on the entire purchase amount, reserves the initial appointment and produces a QR token after payment. RESERVE_NOW is UNPAID with immediate QR, no payment reservation expiry and inventory already sold.
- DEPOSIT and RESERVE_NOW require QR verification before salon remainder/full collection. Remaining payment and entitlement redemption cannot be repeated beyond the valid state/quantity.
- Initial Book Now appointments remain protected from direct cancellation. Ordinary cancelled redemptions cease consuming quantity; cancelling repeatedly cannot create extra quantity.
- Appointment expiry excludes group-linked appointments. Group expiry handles its own pending initial appointment and inventory transactionally; PAID, PARTIALLY_PAID and UNPAID Reserve Now purchases are excluded.
- Existing full-unused-purchase refund restriction remains. Partial used-package refunds, cash refunds, new cancellation tiers, fee rules, policy snapshots and policy previews were not added.
- Existing refund-request validation inconsistency is preserved: request creation blocks CONFIRMED/COMPLETED linked appointments, while approval/processing requires all linked appointments CANCELLED. Requests can therefore require manual review even if initially accepted.
- The subsequent Book Now integration replaced both hardcoded guards with the strict environment flag ENABLE_BOOK_NOW_PURCHASE, default false. No deployed flag was enabled. New public API tests cover creation, Stripe/wallet full/deposit settlement, Reserve Now, QR, salon payment, duplicate intents and expiry. Earlier seeded tests remain as lower-level regression coverage.

## Schema and migrations

New fields:

- Refund: nullable unique refundClaimToken, nullable refundClaimExpiresAt, nullable refundAttemptedAt.
- GroupPurchase: nullable unique settledPaymentId with a restrictive Payment foreign key and named Prisma settlement relation.

PostgreSQL additions:

- `20261021120000_refund_attempt_fence/migration.sql` adds durable attempt metadata and conservatively marks all historical late-group refunds as possibly attempted.
- `20261021121000_group_settlement_identity/migration.sql` adds canonical settlement identity and backfills only a single successful non-salon payment for an already purchased group.
- The user's existing unapplied group-flow, booking-payment-field and refund-idempotency migrations remain unchanged.

Cloudflare additions, after immutable v1-v3:

- 0004_unified_group_purchase.sql: existing unified-flow fields, Refund.idempotencyKey, WalletTopup promotion index. Build appends precision triggers for the newly added monetary columns.
- 0005_refund_attempt_fence.sql: attempt/lease metadata and conservative historical attempt backfill.
- 0006_group_settlement_identity.sql: canonical Payment reference and unambiguous legacy backfill.

Build checks apply the entire SQLite migration chain to a disposable database and compare it with the generated Prisma schema. The upgrade fixture preserves pre-upgrade wallets, top-ups and branch policies, validates historical attempt backfill, claim compare-and-set, foreign keys and migration checksum rejection. No existing migration file was overwritten.

## Refund state and recovery

| Durable state | Meaning and next action |
| --- | --- |
| PENDING, no attempt, no provider ID, no live claim | A worker may claim, validate the original PI and competing refunds, persist an attempt, then submit once. |
| Claim active, attempt absent | Another worker is validating; do not submit. A genuinely expired unattempted lease can be claimed. |
| Attempt present, no provider ID | Provider outcome may be unknown, including a crash between fencing and sending. Only retrieval/list reconciliation is allowed. |
| Provider pending/requires_action | Keep local payment unrefunded; wait for provider progress or investigate required action. |
| Provider failed/canceled | Persist FAILED only after provider verification. Do not automatically submit another refund. |
| Provider succeeded | Atomically finalize local records; repeat finalization has no extra financial or notification effect. |

Stripe may prune old idempotency keys; this implementation therefore does not use an expired claim or a missing listing result as permission to create again. See [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) and [refund listing](https://docs.stripe.com/api/refunds/list).

Recovery procedure:

1. For a late group payment, retry delivery of its original signed success event, or deliver the related signed refund.updated event to the existing Stripe webhook. Both follow the same stored refund identity. Configure refund.created, refund.updated and refund.failed event delivery in the Stripe test endpoint before staging verification.
2. For an approved refund already PROCESSING, the authorized admin can call the existing process endpoint again. It performs read-only Stripe reconciliation before local finalization. Related group refund events also reconcile it.
3. If the provider ID was lost, automatic listing recovery requires a unique matching refund and a matching PaymentIntent, amount and currency. Listing is bounded to 300 records per reconciliation call.
4. If no match exists, there are multiple matches, the legacy settlement is ambiguous, or a provider response mismatches: investigate in the Stripe test dashboard and database. Do not clear refundAttemptedAt, create a replacement refund row, change the idempotency key, or repeatedly press refund. There is deliberately no automatic money-moving override.
5. After verified external completion, retain all provider IDs/audit history. An external refund cannot be undone by rolling back a local transaction.

## Files changed in this task

Production: payment.service.ts; new payment/late-group-refund.ts; wallet.service.ts; group-purchase.service.ts; group-purchase-expiry.service.ts; refund-request.processing.ts; Prisma payment/group-purchase schemas.

Deployment: the new PostgreSQL/SQLite migrations above; scripts/build-cloudflare.mjs; scripts/check-cloudflare-schema.mjs; regenerated cloudflare/prisma/schema.prisma and runtime/model-metadata.json; package.json.

Tests: new cloudflare/group-refund-safety.test.mjs; new runtime/group-safety-fixture.mjs; runtime/integration-fixture.mjs; runtime.integration.test.mjs; runtime/migration-fixture.mjs; runtime/database-fixture.mjs; scripts/test-cloudflare-migrations.mjs; notification-regression.test.mjs (updated expired-purchase fixture).

The broader worktree already contains user changes to appointment, group purchase routes/validation/controllers and schema. Those were inspected and preserved, not replaced with an alternate architecture.

## Verification and limits

- Latest `npm run test:regression`: 131 tests passed, zero failed/skipped (38 errors, 8 auth, 3 SMTP, 4 database retry, 24 booking, 8 notifications, 22 group-refund safety, 12 isolated financial proofs, 1 Worker integration test, 11 public Book Now E2E tests including nested subtests). The Worker test contains additional service assertions, not separately counted TAP tests.
- Final Worker integration rerun after adding concurrency/multiple-appointment assertions: 71 group-purchase service checks passed. `prisma validate --config cloudflare/node-client.config.ts`, TypeScript build and SQLite migration/adapter checks passed. Historical v1 checksum matched committed pre-change metadata. Initial fixture/CAS/signature-test failures were fixed; they are not outstanding failures.
- 22 focused tests execute the production late-refund helpers with synthetic configuration and mocked Stripe. They exercise competing claims, unknown outcomes, timeout after provider acceptance, missing ID recovery, expired claims, provider states, identity/amount/currency/metadata failures and legacy duplicate protection.
- The actual Worker suite runs real Express middleware and production services on SQLite. Its group fixture checks Stripe and wallet Buy Later settlement; seeded Book Now full/deposit settlement; QR and salon collection; debit/refund conservation; duplicate effects; customer/manager restrictions; entitlement quantity/cancellation; inventory capacity/expiry; late refund recovery; canonical-payment replay; signed refund webhooks; approved-refund retry.
- Existing auth, errors, standard booking, notification, database adapter and financial-proof suites remain part of test:regression. Synthetic Stripe responses do not represent a live charge or refund.
- No PostgreSQL server was contacted. Applying these PostgreSQL SQL migrations and real multi-process PostgreSQL concurrency are NOT VERIFIED. Prisma validation/typecheck and SQLite schema parity are separate checks, not a substitute for PostgreSQL migration rehearsal.
- Public Book Now creation and payment lifecycle are now VERIFIED in local Cloudflare end-to-end tests with explicit test-only flag=true and mocked Stripe; live staging checkout remains NOT VERIFIED until an authorized deployment/opt-in and Stripe test-mode acceptance. See BOOK-NOW-STAGING.md.
- Real Stripe network delivery, delivery retry timing, deployed staging secrets, account permissions and frontend flows are NOT VERIFIED by offline tests.
- Unknown provider outcomes with no unique recovered refund remain safe but require operator investigation; automatic retries cannot safely distinguish a pre-send crash from an accepted request whose response was lost.
- Refund finalization may require investigation if another action changes a linked appointment to an ineligible state after external success. Provider money movement remains authoritative; local failure does not authorize another refund.
- No new recurring provider polling/alarm was added. Existing minute cron remains bounded by the expiry batch and three serialization attempts per item. Corrupt legacy inventory/initial-appointment rows can still require manual repair; no entitlement or inventory ownership rule was invented to hide corruption.

## Staging checklist

1. Rehearse PostgreSQL migrations on a disposable restored database if the Node/PostgreSQL deployment is used. Inspect ambiguous historical settlements and duplicate refunds before traffic cutover.
2. Run npm run test:regression and the existing Cloudflare build/check commands. Do not reset the database or change the DO singleton/class to bypass a checksum failure.
3. Review backups and apply only the new migration chain through the normal authorized staging deployment. No environment/flag enablement is required for this hardening.
4. With Stripe test keys, verify signed purchase success/failure and refund.updated delivery. Verify one provider refund, one local refund, one completion notification, and stable inventory on event replay.
5. Test wallet paid/bonus balances before payment, after payment and after approved refund. Test QR/salon RBAC with a cross-branch manager and duplicate requests.
6. Book Now defaults disabled. The public API integration is locally verified; explicitly opt in on staging with ENABLE_BOOK_NOW_PURCHASE=true only when ready to run the live Stripe test-mode checklist in BOOK-NOW-STAGING.md. No flag or deployment was changed automatically.
