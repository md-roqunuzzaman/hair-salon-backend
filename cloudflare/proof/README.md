# Local D1 financial migration proof

This isolated experiment tests D1 persistence for a prevalidated PAY_NOW booking, a bonus first HKD wallet payment, and an approved full appointment refund. It is not connected to Express or the production database. Run it with `npm run test:cloudflare`.

## Verification status

On 2026-10-16, all 12 Miniflare D1 tests passed using the local workerd runtime. They exercise the D1 binding, including concurrent requests and trigger rollback. The earlier Windows runtime download problem is resolved. These are local tests, not remote Cloudflare staging results.

`npm run test:booking` also passed 24 regression tests for current availability, booking services and Express HTTP contracts. That suite uses database fixtures; it does not connect the production services to D1. See [booking verification coverage](../README.md) for the distinction and remaining migration work. `python cloudflare/proof/sqlite-smoke.py` provides six additional SQLite checks.

All fixture balances and prices use integer cents. `schema.sql` creates a disposable D1 schema in Miniflare; `financial-flow.mjs` sends parameterized statements through its real D1 binding. Tests create fresh databases and dispose the runtime after each case. No Cloudflare account or production secrets are required.

## Atomicity design

A payment is one SQL insert. Database triggers validate the booking and wallet, then debit balances, confirm the booking, write a ledger entry and create a notification. A failed constraint or trigger aborts the entire statement, including earlier trigger changes. Bonus allocation happens inside the statement, avoiding a stale balance read in JavaScript.

A refund is also one insert. It validates an approved request, full payment amount, request creation before the cancellation cutoff, confirmed booking and original deduction ledger. It restores the exact paid and bonus components, writes a refund ledger entry, cancels the booking and marks the request refunded. A unique payment reference prevents two refunds from restoring the same payment.

Unlike the current production ledger's separate paid and bonus rows, this proof uses one row with two components. A production implementation must preserve existing ledger API responses and references. It also needs a Payment status representation and the existing refund notification payloads.

## Test coverage

The suite checks successful payment and full refund, disabling bonus use, concurrent duplicate payments, concurrent spending across bookings, wrong ownership, hold expiry at its boundary, failure after debit, refund approval and cutoff rules, concurrent refund requests, failure during refund, single capacity slot contention, ledger corruption and exact integer amounts.

## Scope before API integration

Booking creation here only demonstrates a unique single capacity slot. It does not implement branch hourly capacity, staff schedules, durations, policy validation, service/package availability or expired hold cleanup. Those must be ported and tested against the current appointment service before this becomes a booking backend.

The financial proof does not implement Stripe pending payment exclusion, deposits, reserve bookings, group purchases, topups, refund request creation/reviewer authorization, all production notifications, error/status mapping or HTTP response compatibility. The fixtures represent prevalidated booking and reviewer decisions; they are not authorization mechanisms.

Refund uniqueness intentionally covers a single full appointment payment. Group purchases and any future partial refund allocation need separate designs. Payments reject a second attempt; they do not replay a stored HTTP response. The caller must not automatically interpret every failure as a successful prior operation.

Miniflare 3 is pinned for the repository's Node 20 environment, with compatibility date 2025-07-18. Before production integration, upgrade the development Node runtime and validate against current Cloudflare tooling and a remote staging D1 database. Local concurrency tests do not establish production throughput or full feature parity.

## References

- [D1 binding and atomic batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [SQLite trigger semantics](https://www.sqlite.org/lang_createtrigger.html)
