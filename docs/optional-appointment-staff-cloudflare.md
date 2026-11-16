# Issue #152 Staff-Free Booking: release preparation

Local verification completed on 2026-11-16. **Requested local release gates pass. This is a staging-ready candidate, subject to live ledger/recovery verification.** No staging/production deployment, live data operation, secret change or delivery-setting change was performed.

## Final results

| Check | Passed | Failed | Skipped/cancelled |
| --- | ---: | ---: | ---: |
| Booking, staff availability/schedule and no-show Node regression | 66 | 0 | 0 |
| Complete existing Cloudflare API suite | 48 | 0 | 0 |
| Worker staff-free lifecycle, staff availability/schedule, no-show, branch-limit and security suites | 63 | 0 | 0 |
| Exact production Worker artifact checks | 2 | 0 | 0 |
| **Distinct final TAP tests** | **179** | **0** | **0** |

Also passed: TypeScript; both Prisma schema validations and client generations; generated SQLite schema parity; all historical migration checks and populated v40-to-v41 preservation/rollback; production source freshness/isolation; and the v41 release manifest, which confirms 94 unchanged historical migration files. Non-TAP checks are not counted as additional tests.

Final staging upload dry-run: **7828.02 KiB / gzip 2139.08 KiB**. Normal production Worker: **3,884,370 bytes**. Exact-artifact tests compare bundled first-party sources with current files, exclude synthetic fixtures/provider stubs, initialize disposable current-version storage and forbid outbound provider I/O.

Repeated diagnostic runs are excluded from 179: the four focused staff-free tests are included in the Worker suite; the five remaining-payment entries are included in API. The unrelated full `test:regression` aggregate was not run in this continuation.

## Failure classification and fixes

Baseline replay reproduced **16/66 booking passes, 50 failures**, and **43/48 API passes, 5 failures**. [Every failed TAP entry is classified here](issue152-regression-classification.md), including failed parents. Full raw errors/output and exit-code JSON are retained under `node_modules/.cloudflare-test/issue152/`.

- Booking fixtures omitted ACTIVE staff status. The fairness mock required `where.status` even when absent and discarded returned status. Fixing projections/query semantics restores all 66 tests. The no-eligible-staff fixture now uses a configured inactive stylist; an empty assignment set intentionally allows staff-free availability. Existing distinct-reason and booking assertions remain.
- API fixtures attempted DIRECT_BOOK creation, retired by committed change `1da2954`. Legacy remaining-payment tests now seed a persisted historical deposit, then exercise real QR, ownership, wallet/Stripe settlement, exact amounts, replay and duplicate-payment checks. Retired creation explicitly returns validation 400 with no writes. Paid-voucher redemption retains real branch-break rejection and successful boundary bookings.
- My Orders retains its exact key-list assertion, now including the committed `quantity` field, with exact values: 2 for the linked group purchase, null for other orders.
- The broader Worker discovery run found five further failed TAP entries from retired DIRECT_BOOK requests. Paid-voucher redemption now covers package-component eligibility and all nine Service/Standard/Group conflict combinations, preserving 409 and unchanged-state assertions. All three retired creation methods explicitly reject with 400; delisted paid vouchers still redeem. All nine combinations now execute, increasing that suite from 60 to 63 entries.

No failing test was skipped, deleted or disabled. Exact-money, authorization, QR single-use, refund/state, isolation, fairness, overlap and error-envelope assertions remain. Contract assertions changed only where committed API behavior had already changed, with explicit state/value checks.

## Real application bugs fixed

1. **Temporary branch moves:** availability discarded persistent home-branch assignment when an override moved a stylist away and exposed NO_STAFF slots. Transactional booking ignored incoming overrides, so destination preview and booking could disagree. Both now detect persistent assignments plus incoming overrides; schedules determine actual availability. The added Worker test failed before the fix and passes after it: home branch returns no slots/409 without writes; destination AUTO/manual bookings retain the correct stylist.
2. **Package skill eligibility:** configuration detection filtered out assigned package stylists missing a component service skill and incorrectly enabled staff-free fallback. Both paths now detect package assignment first and apply skills to eligibility. The added test failed before the fix and now asserts no slots, 409 and unchanged state.

Added real Worker lifecycle tests cover nullable staff for all payment methods, exhausted branch capacity, wallet/remaining settlement, appointment details, owner QR verification, manager scope, single-use QR, cancellation without financial mutation, the completed staff-free review guard/pending-list exclusion, standard packages and paid-voucher redemption. Configured inactive staff never become staff-free availability. Existing Worker moderation/security checks retain staffed-review behavior.

## Files changed in this continuation

| Area | Files |
| --- | --- |
| Application | `src/app/module/appointment/appointment.service.ts`, `src/app/module/availability/availability.service.ts` |
| Existing tests | `cloudflare/booking-regression.test.mjs`, `cloudflare/branch-breaks.integration.test.mjs`, `cloudflare/my-orders.integration.test.mjs`, `cloudflare/remaining-payment.integration.test.mjs`, `cloudflare/staff-availability.integration.test.mjs` |
| Additional Worker regressions | `cloudflare/optional-staff.integration.test.mjs` |
| Disposable controls | `cloudflare/runtime/book-now-fixture.mjs`, `cloudflare/runtime/staff-availability-fixture.mjs` |
| Evidence tooling | `scripts/verify-issue152.mjs`, `scripts/report-issue152.mjs` |
| Reports | This file, `docs/issue152-regression-classification.md`, `cloudflare/README.md` |

The shared tree already contained the nullable schema, v41 implementation and other ongoing edits. Those were preserved. This continuation does not edit v41 SQL, prior migrations, payment/review business logic, secrets or Wrangler delivery flags. Regenerated clients/build/evidence files are ignored artifacts.

## Migration and remaining rollout risks

SQLite v41 replaces Appointment while foreign keys stay enabled. One `storage.transactionSync()` saves Payment appointment links and Review/ReviewImage rows, detaches those references, replaces the parent, restores every reference/row, recreates indexes plus eight money/two order-number triggers, removes staging tables and records its ledger entry. Order number also becomes physically NOT NULL. Existing assignments, money, refund links, replies and image metadata remain unchanged. PostgreSQL migration `20261116061818_support_staff_optional_booking` remains separate and is not executed by Workers.

Populated upgrade tests compare every application row and trigger definitions. Injected failures immediately after dropping the old table and after completing SQL restore prior rows, schema and ledger. Null staff insertion/update, later assignment, invalid staff rejection, order-number constraints, money guards, foreign keys, repeat startup and review-image cascades pass.

**Staging assessment:** no unresolved failure remains in the requested local checks; the candidate is suitable for a controlled staging rollout. Current live ledger/checksums, data volume and recovery usability were not accessed or verified. Before rollout, verify the staging ledger and retain a usable recovery point plus a v41-compatible recovery Worker. Table replacement copies appointments/reviews/images and temporarily updates linked payments, so startup/storage usage scales with live data size. Preserve the namespace, `SalonDatabase` class and `salon-v1` identity. An older Worker rejects the newer ledger.

Real Stripe/Tencent/email behavior and deployed staging smoke tests remain rollout checks; integrations use synthetic providers. Staging delivery remains true and production false. Dry-run success does not apply migrations or certify a live account. No deployment was performed.

## Reproduce and inspect evidence

```powershell
node scripts/verify-issue152.mjs schema final
node scripts/verify-issue152.mjs booking final
node scripts/verify-issue152.mjs api final
node scripts/verify-issue152.mjs worker verified
node scripts/verify-issue152.mjs production final
node scripts/verify-issue152.mjs dryrun final
node scripts/report-issue152.mjs
```

Run sequentially so builds do not replace artifacts during another check. Each invocation saves `<suite>-<label>.log` and count/exit-code JSON under `node_modules/.cloudflare-test/issue152/`. Historical failures: `booking-before`, `api-before`, `worker-final` (initial broader Worker discovery), `focused-move-before`, `focused-package-before`. All-green Worker evidence is `worker-verified`, not historical `worker-final`. Release manifest: `cloudflare/.build/unified-merchant-email-release-manifest.json`.
