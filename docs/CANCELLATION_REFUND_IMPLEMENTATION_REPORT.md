# Merchant policy implementation report — 22 October 2026

## Overall status

The Cloudflare implementation is built and locally verified for staging acceptance. It is **not certified as 100% production-ready**: no deployed acceptance or PostgreSQL migration rehearsal was performed. No Worker was published, feature flag enabled, real email sent, live database modified, or real Stripe charge/refund made.

Final full `npm run test:regression` completed with exit code 0: **196 TAP tests passed, zero failed/skipped**. This includes 34 new calculation/validation tests and 23 new Worker API tests (22 scenarios plus their parent test), alongside the existing 139 tests. The Worker suites contain additional assertions within their tests. TypeScript checking, Prisma validation, SQLite schema parity/upgrade and production build passed. Staging `wrangler deploy --dry-run --env staging` completed with exit code 0 and reported `7194.66 KiB / gzip: 1997.31 KiB`, the existing SALON_DB binding and `--dry-run: exiting now.` A dry-run is bundle validation, not a deployed migration or signed-provider-delivery test.

## Stages completed

| Stage | Result |
| --- | --- |
| Inventory and compatibility | Recorded baseline before route edits; all 148 existing method/path combinations and middleware/controller registrations retained. 15 additive routes, no collisions. This checks registrations, not every possible response of all 148 APIs. |
| Schema/configuration | Three independent branch policies; version checks, scoped merchant authorization, fixed/percentage terms, explicit historical tier formats/boundaries. |
| Snapshots/discovery | New service bookings, group purchases with explicit policy branch and group redemption bookings persist applicable terms. New public policy and preview APIs added. |
| Cancellation | Service policy cancellation, zero refund, positive request, atomic slot release, durable duplicate handling; group restoration/forfeiture accounting. Initial Direct Booking protection retained. |
| Refund processing | Existing owner review/process workflow uses frozen request calculations, eligible original payments and current money/quantity guards. Wallet proportional paid/bonus return; Stripe submission/reconciliation and completion notifications/audits. |
| Verification/delivery | Full local regression, schema/migration/build checks, staging dry-run, API guide and 40-request Postman collection. Deployed provider acceptance and PostgreSQL rehearsal remain open. |

## Files created

- `src/app/module/cancellation-refund/`: calculation, snapshot, validation, interfaces, policy management service/routes, cancellation/refund service/controller/routes and financial validation/finalization helpers.
- `prisma/migrations/20261022140000_merchant_policy_execution/migration.sql` and `cloudflare/migrations/0012_merchant_policy_execution.sql`.
- `cloudflare/policy-calculation.test.mjs`, `cloudflare/merchant-policy.integration.test.mjs`, and shared `cloudflare/test-support/public-worker.mjs`.
- `scripts/inventory-routes.mjs`, `scripts/create-policy-postman.mjs`, `docs/cancellation-refund-existing-routes.json`.
- `docs/CANCELLATION_REFUND_POLICY_API.md`, this report, and both JSON files in `docs/postman/`.

## Files modified by this implementation

- Runtime integration: `src/app.ts`; appointment and group-purchase services; group-purchase validation; refund-request service/processing; payment webhook service; existing branch policy services for explicit legacy tier semantics.
- Schema: BranchCancellationPolicy/GroupPurchaseRefundPolicy, Appointment, GroupPurchase and Branch models; regenerated Cloudflare schema/model metadata. Existing RefundRequest policy/quantity fields are reused.
- Build/tests: package scripts, Cloudflare build/schema migration registration; booking/book-now fixtures and tests; Worker integration/database/migration fixtures; migration test runner. Existing test-only provider fixtures simulate provider states and expose no production endpoints.
- Documentation: Book Now guide now points to current v12 behavior. Earlier worktree changes, v10/v11 schemas/routes and migration mapping were preserved.

The worktree contained user changes before this task. The list above describes this implementation; `git status` also includes those earlier changes. No commit or applied-migration rewrite was performed by this implementation.

## Routes and frontend contract

All 15 new route registrations and complete sample policy/confirmation bodies are listed in [the API guide](CANCELLATION_REFUND_POLICY_API.md). Existing route registration inventory is [saved separately](cancellation-refund-existing-routes.json). The API guide documents old-route enforcement, preview staleness, idempotency, status codes and numeric versus Decimal serialization.

Import [the collection](postman/merchant-cancellation-refund.postman_collection.json) and [the staging environment](postman/merchant-cancellation-refund.staging.postman_environment.json). All 40 request definitions were checked, including body JSON after numeric version substitution. No actual account token/secret is embedded. Postman requests were prepared, not executed against staging. Optional QR/salon requests must run before cancellation; they apply only to eligible DEPOSIT/RESERVE_NOW bookings.

## Schema and migration status

- v12 adds service refund permission and explicit policy formats; group boundary mode; nullable purchase branch FK; unique cancellation idempotency key and stored cancellation result.
- Existing old-format policies keep refundable-value and minimum-inclusive semantics. New API group tiers explicitly use upper-inclusive boundaries. New historical branch/snapshot fields stay null unless an actual checkout supplies them. Existing snapshots are preserved.
- Cloudflare runs SQLite inside the existing SalonDatabase Durable Object. v12 is additive; its upgrade fixture checks preserved snapshots/money, branch FK, legacy semantics and immutable checksum handling. v11 still uses the explicitly approved package `9ff78b23-f681-4007-a44c-ef4277decf17` → branch `f7318524-db7c-49cf-8bc4-bfc6ff5c6b97`. Any additional unmapped policy causes a safe migration abort.
- PostgreSQL new SQL was generated/checked against Prisma schema changes, and Prisma validation passed. **Execution is unverified.** The already-existing precision migration sorts before the columns it alters; the worktree also changes the earlier policy-schema migration. Inspect applied history and rehearse on a disposable restore before any PostgreSQL deployment. No PostgreSQL server/tools were available for a real rehearsal. Applied migration history was not guessed or rewritten.

## Business behavior verified

Service cancellation evaluates the booking snapshot, Hong Kong appointment time, allowed state and original paid online amount. Cancellation/refund permissions are independent. A 20% deduction from HKD300 yields HKD240; 100% deduction cancels without a refund request. Unpaid Reserve Now cancellation returns no money. A Stripe deposit after salon remainder collection refunds only the eligible deposit; salon money is excluded. Existing ordinary Wallet checkout continues full-price settlement even from a deposit hold.

Group purchase refunds evaluate purchase age and saved package validity, permission for partial use/expiry, available quantity and eligible provider balance. Active reservations block a refund. Forfeited, allocated and refunded quantity cannot be refunded/redeemed again. Positive requests need owner approval; successful refunds invalidate remaining entitlements. Cancelling a redemption is separate from requesting a purchase refund: it releases capacity and restores or forfeits one entitlement atomically, without an immediate money refund.

Wallet completion restores the original paid/bonus split transactionally and conserves money. Stripe completion verifies provider identity/amount/currency. Pending/unknown outcomes reconcile the same persisted attempt and never authorize another submission. Duplicate confirmations, concurrent cancellation/processing and duplicate signed provider events do not create duplicate money, quantities or completion notifications. Existing late-payment refund fences and canonical payment identity remain in place.

## Outstanding decisions and limits

1. The initial Direct Booking appointment still cannot be cancelled directly. Enabling it requires an explicit whole-purchase cancellation design covering unpaid/deposit QR and salon settlement; cancelling only the anchor appointment would strand that workflow.
2. Active group reservations remain a hard refund block even if the legacy compatibility setting is false. No silent bulk cancellation rule was invented.
3. Zero-money group refunds do not burn the whole purchase. A separate forfeiture decision is required if that is desired.
4. Approval remains the existing owner workflow; salon refunds and converting promotional credits to cash remain unsupported. Rejected/failed service refund requests do not reopen an already cancelled booking automatically.
5. Historical missing-snapshot/multi-branch transactions require review. Today's policy is never retroactively attached. Additional old package-policy mappings must be explicitly supplied before v11 can migrate them.
6. Offline tests use real middleware, SQLite runtime and signed webhook verification with synthetic provider responses. Deployed secrets, real Stripe test delivery/retries, browser confirmation and multi-process PostgreSQL locking are not verified. Unknown provider outcomes without a unique recovered refund need operator investigation.

These limits are explicitly documented instead of claiming every acceptance criterion has been verified.

## Final staging deployment

The existing staging Worker was subsequently deployed with explicit approval. Final version `d5d98aa9-71cd-4b28-a9bf-d0973b2c2a09`; live SQLite ledger/checksums verified through v12, original financial data preserved, minute cron restored and 20 non-destructive smoke checks passed. See [the deployment report](STAGING_FINAL_DEPLOYMENT_REPORT.md) for evidence and remaining Postman/provider acceptance limits. Earlier implementation-only statements in this report describe their original verification scope.

## Staging operator sequence

1. Review staging backup and policy mapping audit; resolve any unmapped historical policies.
2. Run `npm run test:regression`, `npm run typecheck`, `npm run cloudflare:build`, then `npx wrangler deploy --dry-run --env staging`.
3. When ready to publish, use the existing `npm run cloudflare:deploy:staging` command. This task did not run it. Keep the DO singleton and existing migration files intact.
4. No new policy flag is needed. Enable `ENABLE_BOOK_NOW_PURCHASE=true` separately only if explicitly testing new Direct Booking checkout; its default was not changed.
5. Use the Postman guide with Stripe test credentials. Complete the checklist for all three standard methods, group cancellation/refund, wallet conservation, role isolation, duplicate submissions and signed provider recovery. Verify database/request/provider states agree before production rollout.
