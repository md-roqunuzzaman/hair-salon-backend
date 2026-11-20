# Admin Order implementation verification — 2026-11-20

## Result

The isolated read-only module passes its PostgreSQL and Cloudflare SQLite/HTTP tests. The repository-wide release is **not fully green**: unchanged booking and legacy Direct Booking regression tests fail with and without the new router. No deployment was performed.

| Check | Pass | Fail | Notes |
| --- | ---: | ---: | --- |
| `npm run typecheck` | Passed | 0 | TypeScript |
| `npm run build` | Passed | 0 | Node production compilation |
| `node scripts/build-cloudflare.mjs` | Passed | 0 | Production Worker bundling only |
| New actual PostgreSQL 18 suite | 18 | 0 | 17 named checks plus enclosing test |
| New workerd/SQLite + HTTP suite | 19 | 0 | 17 shared checks, real HTTP check, enclosing test |
| Existing API regression files from `test:cloudflare:api` | 48 | 0 | Existing auth/session, booking/wallet, remaining payment, banners, branch breaks, registration, rate limits, password changes, search and My Orders |
| Existing group-refund safety suite | 23 | 0 | Financial idempotency and wallet rounding |
| Existing booking regression suite | 52 | 4 | Same result without Admin Order registration |
| Existing Book Now + refund-allocation + optional-staff Worker suites | 13 | 31 | 44 Node test-runner tests, including failed parent tests; same baseline result |
| `git diff --check` | Passed | 0 | Existing CRLF notices only |

No tests were skipped, deleted or weakened. Test-runner counts include enclosing/parent tests and should not be confused with the number of independent failing assertions.

## Exact existing booking failures

All four fail in `cloudflare/booking-regression.test.mjs:520`: the availability fixture expects staff id `023605b9-8628-45aa-be31-82d56635ef6d`, but the response has `staffId: null`.

1. `reported AUTO slot remains bookable; preview staff is not the assigned staff`
2. `reported slot manual booking still selects the explicit staff; root POST is not a booking contract`
3. `reported slot returns the exact 409 if availability changes before POST`
4. `reported slot retains exact 409 on exhausted serializable retries`

An ephemeral loader removed the new import/route registration from app.ts **in memory**, leaving actual source and tests untouched. The unchanged suite produced the same 52 pass / 4 fail result. These are pre-existing availability-contract/fixture failures; resolving whether the preview contract or fixture should change is outside this additive feature.

## Exact additional Worker failures

The main mismatch is the current existing Group Purchase validator, `src/app/module/group-purchase/group-purchase.validation.ts`, which accepts only BUY_NOW_BOOK_LATER. Existing legacy-flow tests submit DIRECT_BOOK creation with staff/date/booking fields. They receive 400 `Invalid input: expected "BUY_NOW_BOOK_LATER"` and unrecognized-key errors. There are 27 direct failed assertions with actual 400; 24 expected 201 and 3 expected 422. Three failed parent tests are additionally counted. The remaining failure is `initial entitlement counts and redemption cannot exceed quantity`: it cannot read the id of a purchase that the preceding failed creation did not produce. New read-only viewing of already stored DIRECT_BOOK records passes; legacy public creation has not been re-enabled.

Failing test names, including parent tests:

```text
Book Now public creation is disabled for flag=missing
Book Now public creation is disabled for flag=false
  PAY_NOW via STRIPE: public purchase to full payment
  DEPOSIT via STRIPE: public purchase to full payment
  PAY_NOW via WALLET: public purchase to full payment
  DEPOSIT via WALLET: public purchase to full payment
  RESERVE_NOW via SALON: public purchase to full payment
  initial entitlement counts and redemption cannot exceed quantity
  public pending purchase expires once and late signed success refunds once
enabled public Book Now creation, Stripe, wallet, QR, salon and expiry end to end [parent]
  disabled methods, absent deposit, invalid deposit and notice/advance rules have no side effects
  configured deposit and automatic staff selection are used, conflicting concurrent bookings cannot both succeed
  concurrent wallet requests debit a Direct Booking only once
Buy Later and policy-driven Direct Booking public regressions [parent]
  PAY_NOW
  DEPOSIT
  RESERVE_NOW
Worker purchase validity snapshot persists across package edits for every purchase flow [parent]
approved stripe+stripe allocations preserve policy, provider identities and single finalization
approved stripe+wallet allocations preserve policy, provider identities and single finalization
approved wallet+wallet allocations preserve policy, provider identities and single finalization
mixed-provider pending/failed Stripe never completes parent or repeats wallet credit; webhook recovery is idempotent
allocation recovery after timeout preserves intent and never duplicates funds
allocation recovery after stripe preserves intent and never duplicates funds
allocation recovery after wallet preserves intent and never duplicates funds
ambiguous historical wallet deductions fail closed without changing balances
allocation failed remains inspectable, does not complete or reissue
allocation canceled remains inspectable, does not complete or reissue
partial original Stripe refund is subtracted and saved allocations cannot over-refund
concurrent request replay returns one parent; rejection releases only unsubmitted allocations
accepted Stripe refund survives Worker restart using durable intent and provider lookup only
```

A test-only baseline bundle was produced by `node tests/admin-order/build-worker.mjs --without-admin-order-router`; its app.ts loader removes only the new import and registration in memory. Disposable copies of the unchanged Worker suites and helper altered only their import/bundle paths under ignored dist/. This baseline produced the identical 13 pass / 31 fail outcome. Original tests and configuration were not edited. The complete local output is in ignored `dist/admin-order-worker-regression.log` and `dist/admin-order-worker-baseline.log`.

## Files and scope

Created:

- `src/app/module/admin-order/admin-order.query.ts`
- `src/app/module/admin-order/admin-order.service.ts`
- `src/app/module/admin-order/admin-order.validation.ts`
- `src/app/module/admin-order/admin-order.route.ts`
- `tests/admin-order/checks.mjs`
- `tests/admin-order/postgresql.test.mjs`
- `tests/admin-order/sqlite.test.mjs`
- `tests/admin-order/worker-fixture.mjs`
- `tests/admin-order/build-worker.mjs`
- `docs/admin-order-management.md`
- `docs/admin-order-verification.md`

Only existing source change: `src/app.ts`, two additive lines (router import and registration). Existing booking/group-purchase/payment/Stripe/wallet/refund/authentication code, models, migrations, existing tests, Cloudflare configuration and environment files were not changed by this task. Pre-existing working-tree changes in those areas were preserved. `git diff --stat` includes those pre-existing tracked changes and does not include untracked new files.

## Remaining limitations

Branch-less purchases without a recognized historical policy branch and resolvable verified Brand owner remain unviewable. Conflicting cross-brand evidence also fails closed. Customer, package assignments and fulfillment branches do not prove the original purchase Brand. See the exact rules in `admin-order-management.md`. Their deployed record count is unknown because no remote data was inspected. Managers cannot view snapshot-only branch-less purchases. Wallet top-ups remain outside commercial service-order totals as approved.

The schema also cannot reliably label every old GROUP_PURCHASE-purpose payment as deposit versus remaining when the initial settlement/deposit evidence is missing. Those records remain visible with their actual fields and `stage: UNCLASSIFIED`; no payment status or stage is fabricated.

There is no claim that all existing regression tests pass, or that the overall repository is release-ready. Fixing the pre-existing availability/legacy-creation test conflicts requires a separately scoped decision; it must not be done by restoring a purchase flow or weakening existing tests within this task. No commit, push, deployment, remote database operation or environment-variable change was performed. All test PostgreSQL clusters were stopped after use.
