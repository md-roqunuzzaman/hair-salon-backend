# Group Purchase initial-payment lifecycle audit and fix

## Evidence and classification

Reported order GH3A5S (`f243cfe4-48fc-4fe0-b811-8bf945f02484`) is BUY_NOW_BOOK_LATER, HKD 123.00, with no booking method or purchase timestamp. Its parent is FAILED while Stripe child `8427390b-56c1-459f-945a-2f75d5112d70` is PENDING.

A read-only Stripe API retrieval during this audit confirmed PaymentIntent `pi_3Udhwa35Sl8k9TrM1BM7fwhq` had status **requires_payment_method**, amount 12300 minor units, amount_received 0 and livemode false. No cancellation, refund, confirmation, database write or other live payment mutation was performed. This is an observation at audit time, not a guarantee of its current state.

A FAILED parent does not imply every historical child failed. A processing capture, a failed attempt on a still-valid reservation, or a successful late capture awaiting refund can legitimately have different parent/child statuses. The confirmed defect is the absence of provider-aware closure/reconciliation for obsolete initial Stripe attempts, plus retry/switch paths that ignored still-chargeable attempts marked FAILED locally.

The reported timestamps are consistent with the five-minute reservation and a later cron run. Without execution logs, they cannot distinguish cron expiry from inline reservation release.

## Traced transitions

| Path | Before fix | Classification |
| --- | --- | --- |
| `groupPurchaseExpiryService.expirePendingGroupPurchases` | Expires PENDING reservation, fails parent/legacy initial appointment and releases inventory; leaves child unchanged | Missing obsolete-intent reconciliation |
| `groupPurchaseService.createGroupPurchase`, expired voucher release | Fails old reservations while allocating a new voucher; leaves old intents unchanged | Same gap; next cleanup now recovers it |
| Initial Stripe failed webhook | Fails child but leaves still-valid parent PENDING | Valid retryable state, but old intent may still accept payment |
| `paymentService.createGroupPurchaseStripeIntent` | Reuses PENDING child; creates a fresh attempt after FAILED without closing old intent | Multiple chargeable intents possible |
| `walletService.payGroupPurchaseWithWallet` | Blocks PENDING Stripe but ignores FAILED Stripe | Old failed-but-chargeable intent could capture after Wallet pays |
| Late/duplicate initial success | Rejects inactive reservation, releases inventory once, records captured funds and refunds through existing durable refund mechanism | Already protects against purchase reactivation; preserved |
| Remaining-payment cancellation/switching | Dedicated provider-aware cancellation/reconciliation | Preserved; excluded from initial-payment cleanup |

Severity: a payment lifecycle/reconciliation defect with temporary duplicate-charge and confusing-status exposure. The reported test-mode intent had received no money. No evidence was found that its failed purchase was reactivated. Existing late-success handling refunds rather than resurrecting an expired purchase, but provider/network failures can defer that refund.

## Implemented behavior

`group-initial-stripe-reconciliation.ts` verifies provider intent id, customer, purchase, purpose, amount, currency and initial-payment identity. It rejects REMAINING metadata and does not touch funded purchases through the background initial-expiry path.

- Read provider state outside database transactions.
- Cancel unpaid, cancellable obsolete intents; require confirmed canceled state and zero received amount before a local FAILED transition.
- Keep processing attempts unresolved rather than inventing failure. Block retry/Wallet actions while funds can still arrive.
- On succeeded retrieval or a cancellation/capture race, use the existing idempotent initial settlement/late-refund path.
- Keep unapplied PAID captures on failed/unfunded purchases in the recovery scan until their refund finishes. A missed webhook followed by a refund timeout must not strand captured funds; the next cleanup reconciles by provider lookup without submitting another refund.
- Re-read after a cancellation error/timeout. Never infer the result from a network error.
- Use conditional writes so settled/refunded records cannot be downgraded.
- Store a namespaced cancellation receipt in the existing StripeWebhookEvent table, atomically with local closure. Preserve historical Payment rows and avoid polling closed attempts forever. No new schema is required.
- On Stripe retry, reuse the valid pending attempt, close failed-but-chargeable attempts and extra pending attempts first, and check again under the purchase lock for a newly raced failure.
- On Wallet switch, cancel and verify outstanding initial Stripe attempts before debiting; a newly raced unverified attempt blocks settlement.
- A signed initial `payment_intent.canceled` webhook is now reconciled idempotently against a current provider retrieval.
- After committed expiry/inventory transactions, cleanup handles up to 100 unresolved failed-parent payment records per run. This also covers historical rows and inline expiry. No Stripe calls occur inside those transactions.

Provider cancellations and database writes cannot be atomic across systems. A confirmed cancellation followed by a failed database write intentionally leaves the local child unresolved; the next run retrieves the canceled intent and completes the conditional update. Provider outages surface a retryable reconciliation failure. The public expiry response shape is unchanged.

Stripe supports cancellation in requires_payment_method, requires_confirmation, requires_action, requires_capture and certain processing cases. This implementation deliberately defers processing rather than attempting to cancel it. Confirmed canceled intents cannot create further charges. See [Stripe's cancellation reference](https://docs.stripe.com/api/payment_intents/cancel).

## Flow coverage and boundaries

- BUY_NOW_BOOK_LATER: creation, initial Stripe payment, expiry, retry and Wallet switching are covered.
- Historical DIRECT_BOOK PAY_NOW/DEPOSIT: persisted-state settlement, expiry and legacy financial safeguards are covered.
- BUY_NOW_BOOK_NOW is not a current enum/API flow. Public creation of it and DIRECT_BOOK remains rejected; no retired creation flow was re-enabled.
- Paid deposits, funded reservations and remaining payments are not initial unpaid reservations. Their existing settlement/cancellation paths remain in place.
- Normal appointment PAY_NOW/DEPOSIT use the separate existing appointment-expiry path. Their local FAILED state is not proof of Stripe cancellation; their late-capture refund handling is preserved and tested. This change does not broaden group cleanup into appointment payments.
- Missing provider identity, mismatched financial identity, partial received amounts and provider uncertainty are not guessed into a terminal local state. They require retry/reconciliation; partially captured inconsistent historical records may require operator investigation.

## Files belonging to this fix

Production:

1. New `src/app/module/payment/group-initial-stripe-reconciliation.ts`.
2. `src/app/module/group-purchase/group-purchase-expiry.service.ts`: post-transaction reconciliation call.
3. `src/app/module/payment/payment.service.ts`: safe retry preflight, raced-failure guard and canceled-event handling.
4. `src/app/module/wallet/wallet.service.ts`: provider-confirmed initial switch preflight and raced-attempt guard.

Tests/documentation:

1. New `cloudflare/group-initial-reconciliation.integration.test.mjs`.
2. New `cloudflare/runtime/group-initial-reconciliation-fixture.mjs`.
3. `cloudflare/runtime/integration-fixture.mjs`: disposable fixture route only.
4. `cloudflare/runtime/book-now-fixture.mjs`: mock cancellation/provider status controls, preserving earlier appointment-expiry fixture additions.
5. New `tests/group-initial/postgresql.test.mjs`.
6. This document.

Other existing working-tree changes, including appointment expiry, booking tests, licence configuration, Admin Order and refund-request edits, belong to earlier/user work and are preserved. No migrations, dependencies or persistent environment changes are required. No deployment, commit or push is performed.

## Verification evidence

- Group initial Worker suite: **20 passed / 0 failed**, including the existing **71 real SQLite financial assertions**, cancellation/creation timeouts and missed-webhook refund recovery with explicitly licensed disposable configuration.
- Normal appointment expiry/late-capture suite: **8 passed / 0 failed**.
- Remaining-payment Worker suite: **5 passed / 0 failed**, including its parent test.
- Actual PostgreSQL suite: **9 passed / 0 failed**, including its parent test; real concurrent creation/expiry/success, provider-cancellation race, missed-webhook refund recovery and no-provider-I/O-inside-transaction assertions.
- Existing booking regression: **56 passed / 0 failed**.
- Existing group-refund safety: **23 passed / 0 failed**.
- PostgreSQL and Cloudflare Prisma schema validation passed.
- TypeScript type checking, Node production compilation, Cloudflare production bundling and diff whitespace checks passed.

The PostgreSQL test starts/stops an isolated localhost PostgreSQL 18 cluster under ignored dist/, uses only synthetic records and mocked Stripe, and does not use the remote application database. Worker tests use ephemeral Miniflare storage and synthetic Stripe. Test-only licence overrides do not modify the real feature-license configuration.

Logs are local ignored artifacts: `dist/group-initial-worker-final.log`, `dist/group-initial-cross-flow.log`, and `dist/group-initial-postgresql.log`. These tests are not a deployed staging smoke test. The reported staging record was not manually repaired; normal cleanup can reconcile it only after the reviewed code is deployed and the provider's current state is verified again.
