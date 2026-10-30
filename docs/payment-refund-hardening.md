# Payment and refund hardening — local v30 candidate

Date: 2026-10-30. Scope: local source changes, mocked providers and disposable databases only. No deployment, live migration, real charge/refund/email, secret change or delivery-flag change was performed.

## Architecture and compatibility

The existing Express routes, RBAC, response envelopes, Prisma transactions, Stripe webhook signature verification, Cloudflare Durable Object database/queue, merchant review/process APIs, policy snapshots, QR rules and in-app notifications remain in use. AUTO staff selection, prices, deposit percentages, cancellation deadlines, quantity eligibility and email routing were not redesigned. Other uncommitted banner, registration, policy-minute and payment-history work in the shared workspace was preserved.

Single-source refunds retain their existing processing paths. `RefundRequest.paymentId` remains the primary compatibility anchor; `refundId` points to that anchor's Refund. For a multi-source group refund, the detail/process response adds `allocations`, with each payment/provider/amount/refund/status/safe error independently inspectable. The parent amount is the total across allocations, so clients must not interpret it as a second refund on the anchor payment.

Ordinary customer refunds still require the existing merchant approval. Only verified captures that cannot be applied use the existing separate late/duplicate-payment compensation policy. No direct refund route was enabled, no new debug route was added to the production Worker and no new scheduler was introduced.

## Confirmed defects and fixes

| Finding | Cause | Implemented correction |
| --- | --- | --- |
| Group refund rejected multiple settled sources | Preview/processing assumed one Payment | Aggregate eligible source balances and persist a deterministic allocation plan under one parent request |
| Ambiguous wallet funding attribution | Initial deductions referenced a booking/purchase; later deductions referenced payment IDs | New deductions retain their reference and also record explicit paymentId plus a unique ledger key; ambiguous old multi-payment provenance fails closed |
| Group marked REFUNDED after a partial/source refund | Finalizers assigned REFUNDED unconditionally | Aggregate settled funds and successful refunds across the purchase; preserve PARTIALLY_REFUNDED while funds remain |
| Captured duplicate/ineligible remaining payment repeatedly errored | Settlement returned a reconciliation error without a durable refund intent | Persist compensation intent atomically with capture recording, then reconcile outside the transaction; preserve the winning funding/booking |
| A different initial appointment intent could be treated as a repeat of the winning intent | Idempotence relied on appointment state without identifying the funding source | Serialize on appointment, distinguish same-payment replay from another settled source and compensate only the losing capture |
| Old late-appointment code reopened failed refunds/recreated requests on timeout or finalization failure | Stable provider key alone was treated as sufficient long-term duplicate protection | Reuse permanent attempt fencing and bounded provider lookup; never automatically re-create an uncertain submission |

The existing single approved-Stripe path already preserved uncertain requests as PROCESSING/PENDING. It was extended with identity/metadata verification and resource locking, rather than replaced.

## Allocation, financial and recovery invariants

- Policy eligibility and unused-quantity calculations remain authoritative. Eligible online funds retain their original Stripe/Wallet provider. SALON funds are not silently converted into an automated Stripe/wallet refund.
- Allocation order is FIFO by Payment.paidAt, then createdAt, then ID. Successful refunds and reserved allocations reduce each source balance. The saved plan is revalidated at approval/claim and never recalculated on a process retry.
- Request creation, rejection/reservation release and execution claims use the existing serializable/resource-lock pattern. Execution locks the purchase, parent request and source payments in sorted order. Wallet updates additionally lock the wallet.
- New wallet deductions and credits have unique ledger keys. Credits use original paid/bonus funding and cumulative integer-cent rounding, so partial refunds restore the same final paid/bonus totals without cent drift.
- Stripe intent and refund identity, amount, currency and correlation metadata must match. Network creates occur after local commit, with the saved idempotency key, zero SDK network retries and a 15-second request deadline.
- `submittedAt`/`refundAttemptedAt` is a permanent fence before the external side effect. Subsequent calls retrieve a known refund or scan at most three pages of 100 refunds. An absent match is not proof that no refund occurred.
- A timeout or accepted-send persistence failure stays unresolved. Reprocessing performs provider reads, not another create. No-match, ambiguous history or multiple provider matches require operator investigation.
- Parent completion and refundedQuantity advance only after every required allocation succeeds. Concurrent/replayed completion creates one completion notification/audit and applies quantity once.
- Failed/canceled child refunds stay inspectable. A partially completed parent remains PROCESSING and blocks another request for the same purchase; reprocessing can reconcile the original provider object but never automatically issues a replacement refund. Operator resolution is required for a terminal provider failure.
- A crash after the permanent fence but before the network request can conservatively require manual investigation. There is no exactly-once network guarantee and no new automatic refund-retry scheduler.

Stripe API v1 keys can be pruned after at least 24 hours, so retaining the same string alone does not guarantee permanent deduplication. This implementation retains its local attempt fence and uses provider reconciliation instead of resubmitting uncertain creates. Sources: [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [webhook ordering and duplicate handling](https://docs.stripe.com/webhooks), [refund status/identity fields](https://docs.stripe.com/api/refunds/object).

## Changed implementation files

Paths are relative to the repository root; pre-existing unrelated workspace edits are excluded from this task's list.

| Files | Functions / responsibility |
| --- | --- |
| `src/app/module/refund-request/refund-allocation.plan.ts` | groupRefundFunding, allocateRefund, validateAllocationPlan, lockRefundResource, aggregateGroupRefundStatus |
| `src/app/module/refund-request/refund-allocation.processing.ts` | processAllocatedRefund, reconciliation, permanent submission fencing, wallet execution and aggregate completion |
| `src/app/module/refund-request/refund-request.service.ts` | reviewRefundRequest: active-owner check, saved-plan approval, cancellation of unsubmitted reservations; getRefundRequestById: allocation inspection |
| `src/app/module/refund-request/refund-request.processing.ts` | processApprovedRefund/provider dispatch, approved Stripe identity verification/reconciliation, wallet provenance and aggregate group status |
| `src/app/module/cancellation-refund/cancellation-refund.service.ts` | groupEvaluation, requestGroupRefund, createRequest: aggregate preview and atomic allocation persistence |
| `src/app/module/cancellation-refund/cancellation-refund.interface.ts` | Additive persisted funding snapshot shape |
| `src/app/module/cancellation-refund/policy-refund.execution.ts` | finalizePolicyGroupRefund preserves quantity rules and uses aggregate financial state |
| `src/app/module/wallet/wallet-payment-ledger.ts` | walletPaymentFunding, walletRefundSplit: exact provenance and cumulative rounding |
| `src/app/module/wallet/wallet.service.ts` | deductWalletBalance and its four callers persist source Payment identity inside their original transactions |
| `src/app/module/payment/late-group-refund.ts` | Reuse durable late-capture intent/fence/reconciliation for appointment and group purposes |
| `src/app/module/payment/unapplied-capture.ts` | Reconcile/finalize unapplied captured funds while preserving winning business state |
| `src/app/module/payment/payment.service.ts` | handleStripeWebhook and remaining-payment handler: allocation webhook dispatch, replay/source distinction and durable compensation |
| `prisma/schema/{refundRequest,payment,wallet}.prisma` | Additive allocation relations and nullable wallet provenance |
| `scripts/{build-cloudflare,check-cloudflare-schema,test-cloudflare-migrations,verify-unified-email-release}.mjs` | Include v30, schema parity, upgrade checks and immutable artifact history |
| `cloudflare/prisma/schema.prisma`, `cloudflare/runtime/model-metadata.json` | Generated Worker schema/adapter metadata |
| `cloudflare/{refund-allocation,capture-reconciliation}.integration.test.mjs` | New mocked provider / real Worker SQLite API tests |
| `cloudflare/group-refund-safety.test.mjs` | Existing provider harness extended for generic identity and exhaustive cumulative rounding |
| `cloudflare/merchant-policy.integration.test.mjs` | Correct expected partial group refund state |
| `cloudflare/runtime/{book-now-fixture,integration-fixture,migration-fixture}.mjs`, `cloudflare/test-support/public-worker.mjs` | Test-only fault injection, durable restart and migration assertions; absent from production entry |
| `package.json` | Run new financial suites with existing policy/regression scripts |

## Additive v30 migration

SQLite: `cloudflare/migrations/0030_refund_allocations.sql`.

PostgreSQL: `prisma/migrations/20261030100000_refund_allocations/migration.sql`.

New RefundAllocation records link parent request, original payment and optional unique Refund. Uniqueness covers parent/payment, idempotency key and Refund identity; indexes support source/status and reconciliation. Amount must be positive; Worker SQL additionally enforces integer minor units and the existing decimal range. Status has an allowlist. Foreign keys use RESTRICT to preserve financial history.

WalletTransaction gains nullable paymentId and unique nullable ledgerKey. Historical rows remain NULL and balances are unchanged. No allocations or provider identities are guessed/backfilled. Existing requests/refunds, old migrations and policy snapshots are retained.

SQLite applies DDL and ledger insert through the existing transactionSync runner. PostgreSQL SQL has explicit BEGIN/COMMIT. Apply only once through the versioned runner. Never run additive SQL repeatedly by hand or edit `_Migrations`.

Local checks cover an injected v30 failure after additive DDL, rollback to v29 without partial columns/table, successful upgrade without changing old financial values, repeated initialization, foreign keys, source uniqueness and integer/positive/range checks. These do not certify a live PostgreSQL upgrade or PostgreSQL row-lock contention.

## Release sequence and remaining limits

No new environment variable or secret is required. Existing staging/production flags and credential values were left as found; this task does not authorize changing email delivery.

1. Obtain separate staging-release approval. Verify the current Worker version, namespace/singleton, immutable ledger and a fresh usable non-disruptive backup/recovery point. Keep the frontend API online.
2. Rehearse all currently pending migrations on a disposable copy of the actual current staging schema/data. The historical local v19 backup is recovery-test input, not a current staging backup.
3. Retain a v30-compatible recovery artifact. After applying v30, the previous v29 Worker is not an automatic rollback target because its ledger checker rejects the new version. Do not restore an older database over newer writes without separate recovery approval.
4. Run `npm run cloudflare:prepare:staging`. Only after approval, deploy using the existing staging command. Durable Object initialization applies pending SQLite migrations; do not run PostgreSQL migrations against Workers, reset, seed or recreate the database.
5. Verify health/auth/frontend endpoints, owner refund inspection and approved mock/staging financial scenarios. Confirm pending/failed/uncertain refunds with provider records before any real operation. No real charge/refund is part of the local verification.
6. A Node/PostgreSQL rollout additionally needs an approved PostgreSQL upgrade and concurrency rehearsal, a verified backup and direct migration connection. Then use the existing versioned Prisma deployment process before starting the candidate. No PostgreSQL migration was executed here.

Legacy ambiguous wallet funding and legacy unapplied captures without sufficient provenance require manual investigation. No live historical financial state was audited or repaired. Stripe test-mode/network/webhook configuration and real account behavior remain external sign-off gates. No production-readiness claim is made from mocks alone.

## Executed verification

Final `npm run test:regression` returned exit code **0**: **298 TAP tests passed, 0 failed, 0 skipped**, across 15 TAP runs, plus non-TAP database/migration/schema/route assertions. This includes Node Prisma generation and production compilation. Injected SQLite/provider errors in the log are deliberate rollback/recovery cases, not ignored test failures.

| Command / check | Actual result |
| --- | --- |
| `npm run test:regression` | 298 passed; exit 0 |
| `npm run test:group-refunds` | Focused run: 23 passed; includes cumulative wallet rounding over 400 totals and boundary paid/bonus splits |
| `npm run test:policy:api` | Expanded intermediate run: 40 passed; final regression includes the added restart and expired-capture cases, 42 passed in this suite |
| `npm run typecheck` | Passed independently and again in final release preparation |
| `npx prisma validate --config prisma.config.ts` | PostgreSQL schema valid; exit 0 verified using the local Prisma Windows shim; no migration/DB access |
| `npm run cloudflare:generate` | SQLite client generated; fresh schema and versioned SQL match |
| `npm run test:cloudflare:migrations` | v30 atomic upgrade/repeat/history/FK/amount constraints passed |
| `node scripts/verify-maintenance-backup.mjs .maintenance-backups/email-provider-20261028/staging-envelope.json` | Local-only restore, SQLite integrity, v19→v30 upgrade and repeat checks passed; 13,319 historical cells preserved |
| `npm run cloudflare:prepare:staging` | Exit 0; artifact manifest v30; 91 historical committed SQL files unchanged; generated Worker JS 3,614,575 bytes |
| `wrangler deploy --dry-run --env staging` using the installed local shim | Exit 0; no upload/deployment; package 7541.94 KiB, gzip 2069.32 KiB |
| Historical route inventory | 148 historical routes checked with existing approved exceptions; no collisions |
| Whitespace check | Passed after removing a moved block's trailing whitespace |

The checked-in staging delivery flag was already **true** under the user's earlier authorization; production remains **false**. Both were preserved. A local artifact/configuration check does not independently certify the current live Worker configuration.

| Flow / invariant | Evidence and result |
| --- | --- |
| Single Stripe and Wallet refunds | Existing policy and group-safety suites pass, including merchant approval, deadlines, QR/check-in restrictions and original funding |
| Stripe + Stripe | Approved unused-quantity partial refund splits across both sources, stays within each payment, parent completes once |
| Stripe + Wallet | Pending/accepted/failure cases preserve the successful wallet credit and reconcile the original Stripe object |
| Wallet + Wallet | Explicit per-payment deductions restore each source's original paid/bonus split; unique ledger keys prevent double credit |
| Historical partial refund | Prior successful refund reduces the source allocation; no payment exceeds its original settled amount |
| Pending / failed / canceled provider refund | Parent does not complete early; quantity unchanged; failed child is visible; repeat does not create a replacement or repeat wallet credit |
| Timeout after provider acceptance | Original durable intent is retained; subsequent process reads provider evidence without another create |
| Accepted Stripe result followed by SQLite failure | Completion rolls back locally; later reconciliation finalizes once |
| Wallet ledger write failure | Balance/refund/ledger/quantity updates roll back together; safe retry credits once |
| Worker restart | Persistent disposable SQLite survives a full Miniflare restart; independent synthetic provider state is restored; owner processing uses lookup, with no additional create call |
| Concurrent execution / request replay | One parent for a repeated request key; concurrent processing creates no duplicate refunds/credits/quantity updates |
| Merchant rejection | Only unsubmitted allocations are canceled; no provider call or credit; source eligibility is released |
| Ambiguous historical wallet source | Explicit manual-reconciliation error; no balance change |
| Losing initial appointment / ordinary remaining / group remaining capture | Earlier failure followed by a later success is compensated once; winning appointment/purchase/funds and wallet ledger are preserved |
| Provider outage before compensation submission | Captured payment and durable refund intent commit together; no attemptedAt fence yet; replay safely continues original intent |
| Expired appointment capture | Accepted-refund timeout reconciles by lookup, no resubmission and no booking reactivation |
| Existing business/auth/email APIs | Full regression and route checks pass; no new business event or delivery activation was added |

Ignored local evidence is under `node_modules/.cloudflare-test/refund-hardening-*`; the final regression and preparation have explicit `.exit.txt` files. The generated release manifest remains `cloudflare/.build/unified-merchant-email-release-manifest.json` and contains artifact/migration hashes without secrets. The backup remains protected and ignored. Earlier failed development runs were corrected; the final full run is the reported 298/0 result.
