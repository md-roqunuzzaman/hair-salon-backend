# Merchant cancellation and refund: API and staging acceptance

Current local v29 candidate: the listed cancellation/rescheduling/refund thresholds and preview elapsed-time fields now use **minutes**. Existing 12-hour cutoffs become 720 minutes; 2-hour minimums become 120; 24-hour restoration becomes 1440. Request/response keys use `Minutes` instead of `Hours`; old request keys are not aliases. Routes, authorization, money, tier boundaries and notifications remain unchanged. Coordinate the frontend field-name/unit update before deploying this API change.

SQLite `0029_policy_time_minutes.sql` and PostgreSQL `20261030060000_policy_time_minutes` convert only live policy columns and tiers once. Existing checkout/refund snapshots and audit history stay immutable; a detached read view converts old hour snapshot keys before policy evaluation. Versions/timestamps are retained. Repeated initialization never multiplies thresholds twice. Never run the migration SQL manually outside its versioned runner. Keep a schema-compatible recovery artifact; pre-v29 binaries are not a safe rollback. No deploy or live migration was performed by this implementation.

Preview fields are `minutesBeforeAppointment` and `purchaseAgeMinutes`; they can be fractional because they reflect actual elapsed time. Editable threshold fields accept non-negative integer minutes, including 30 and 90. Carousel intervals, package validity, booking windows, capacity rates and infrastructure TTLs are outside this change.

Refresh any previews created before rollout rather than reusing their signed confirmation tokens across the API-unit change.

| Previous field | Current field |
| --- | --- |
| cancellationCutoffHours | cancellationCutoffMinutes |
| rescheduleCutoffHours | rescheduleCutoffMinutes |
| minimumCancellationHours (service/group) | minimumCancellationMinutes |
| restorationMinimumHours | restorationMinimumMinutes |
| minimumHoursBefore | minimumMinutesBefore |
| minimumHoursBeforeAppointment | minimumMinutesBeforeAppointment |
| minimumHoursAfterPurchase | minimumMinutesAfterPurchase |
| hoursBeforeAppointment | minutesBeforeAppointment |
| purchaseAgeHours | purchaseAgeMinutes |

This implementation adds branch policies, immutable checkout snapshots, read-only previews, explicit customer confirmation, and the existing owner approval/processing workflow. It does not enable automatic refunds, enable Direct Booking, publish a Worker, or contact Stripe with real credentials. Automated provider responses are synthetic. PostgreSQL migration rehearsal and deployed Stripe test-account acceptance remain required before claiming full acceptance.

## Decisions and preserved behavior

- A new Buy Later purchase must supply `branchId` if any assigned branch has an enabled group refund policy. The existing creation route is retained. The supplied branch must belong to the package; no arbitrary branch is inferred. The new checkout route always requires it.
- A positive refund requires BRAND_OWNER approval and processing through existing refund-request endpoints. Cancellation releases booking capacity immediately and records the financial request atomically; it does not mean that money has already returned.
- Only eligible Stripe/Wallet money is refunded. Salon CASH/CARD/FPS/OTHER collections remain outside automated refunds. Wallet money returns to its original paid/bonus buckets proportionally; bonus never becomes cash. Ambiguous multiple online funding payments require manual review.
- The initial Direct Booking appointment remains protected from cancellation because it anchors QR and salon collection. These new entitlement cancellation APIs support subsequent GROUP_PURCHASE redemption appointments. Defining a whole-purchase cancellation transition for that initial booking is an outstanding product decision.
- Active group appointments must be resolved before purchase refunds. They are never silently cancelled. The persisted `requireNoActiveAppointments` compatibility field does not authorize bypassing this safety rule when false.
- A group tier yielding zero money does not automatically forfeit the entire purchase; preview reports no refundable balance and no refund request is created. A standard service cancellation can succeed with zero refund.
- Missing/disabled merchant configuration for a **new** transaction captures the known existing booking rules as a version-zero legacy snapshot. Existing no-snapshot records retain the original routes/rules; new preview APIs return 409 for manual review. Historical transactions never receive today's policy or an inferred branch.
- Old refundable-value tiers retain `REFUND_TIERS_V1` and minimum-inclusive age semantics. New policy APIs explicitly write the new calculation format/boundaries. Changing a policy affects only future transactions.
- Ordinary appointment Wallet checkout retains its existing full-price settlement behavior, including when started from a DEPOSIT hold. Ordinary Stripe DEPOSIT charges the configured deposit. Group Direct Booking Wallet DEPOSIT retains its existing deposit behavior. This change does not redefine checkout amounts.

## Import Postman

Import both files in [postman](postman): `merchant-cancellation-refund.postman_collection.json` and `merchant-cancellation-refund.staging.postman_environment.json`. Select the staging environment. Tokens are empty placeholders; supply a CUSTOMER token and BRAND_OWNER token. Verify the base URL, package/branch/service IDs, a future Hong Kong booking date and an available HH:mm time. Use distinct slots for separate bookings.

Run selected requests manually in order; do not run every payment alternative against the same purchase. Read each current policy before updating it. Its GET response saves the version; a missing policy uses version 0. PUT requires `expectedVersion` to match an existing policy. A successful PUT updates the saved version. Use a fresh idempotency key for a new operation; retain it when retrying the same confirmation. Do not use production Stripe keys.

## New routes

All paths are relative to `/api/v1`. Existing 148 registered method/path combinations, middleware and controllers are checked by `node scripts/inventory-routes.mjs`. New routes are additive, with no collisions.

| Method | Path | Access |
| --- | --- | --- |
| GET, PUT | `/policy-management/branches/:branchId/service-cancellation` | Owner or assigned manager |
| GET, PUT | `/policy-management/branches/:branchId/group-purchase-refunds` | Owner or assigned manager |
| GET, PUT | `/policy-management/branches/:branchId/group-purchase-cancellations` | Owner or assigned manager |
| GET | `/cancellation-refund/branches/:branchId/service-policy` | Public |
| GET | `/cancellation-refund/branches/:branchId/group-purchase-refund-policy` | Public |
| GET | `/cancellation-refund/branches/:branchId/group-purchase-cancellation-policy` | Public |
| GET | `/cancellation-refund/appointments/:appointmentId/preview` | Owning customer |
| POST | `/cancellation-refund/appointments/:appointmentId/cancel` | Owning customer |
| POST | `/cancellation-refund/group-purchase-appointments/:appointmentId/cancel` | Owning customer |
| GET | `/cancellation-refund/group-purchases/:groupPurchaseId/refund-preview` | Owning customer |
| POST | `/cancellation-refund/group-purchases/:groupPurchaseId/refund-request` | Owning customer |
| POST | `/cancellation-refund/group-purchases/checkout` | Customer; explicit branch required |

New endpoints return the existing `{success,statusCode,message,data}` envelope with HTTP 200 on successful operations. Existing creation routes continue to use 201. Validation failures are 400, access failures 403, missing configuration/resources 404, stale versions/previews/ineligible states 409. The old branchless creation route returns 422 when a configured policy requires a branch. Provider pending processing returns 202; an unknown provider outcome returns an error while preserving PROCESSING state.

## Policy request bodies

Service example (`expectedVersion: 0` only for first creation):

```json
{
  "isEnabled": true,
  "cancellationAllowed": true,
  "refundAllowed": true,
  "minimumCancellationMinutes": 360,
  "nonRefundable": false,
  "deductionTiers": [
    {"minimumMinutesBeforeAppointment":2880,"calculationType":"PERCENTAGE","deductionValue":0},
    {"minimumMinutesBeforeAppointment":1440,"calculationType":"PERCENTAGE","deductionValue":20},
    {"minimumMinutesBeforeAppointment":720,"calculationType":"PERCENTAGE","deductionValue":50},
    {"minimumMinutesBeforeAppointment":360,"calculationType":"PERCENTAGE","deductionValue":100}
  ],
  "expectedVersion": 0
}
```

At exactly 48/24/12/6 hours, the corresponding tier applies. Below 6 hours, cancellation is forbidden. A paid HKD300 appointment at 25 hours refunds HKD240 after approval; at 7 hours it cancels with no refund. `refundAllowed:false` or `nonRefundable:true` permits cancellation when otherwise allowed but refunds zero. `cancellationAllowed:false` blocks cancellation. A `FIXED` deduction uses HKD and is capped at eligible money. Values use two decimal places; percentage calculations round half-up to cents. Duplicate thresholds, missing minimum coverage, negative values and percentages over 100 are rejected.

Group refund example:

```json
{
  "isEnabled": true,
  "refundAllowed": true,
  "allowPartiallyUsedRefund": true,
  "allowExpiredRefund": false,
  "requireNoActiveAppointments": true,
  "refundTiers": [
    {"minimumMinutesAfterPurchase":0,"refundPercentage":100},
    {"minimumMinutesAfterPurchase":1440,"refundPercentage":80},
    {"minimumMinutesAfterPurchase":4320,"refundPercentage":0}
  ],
  "expectedVersion": 0
}
```

For this new API, age <=24 hours refunds 100%; >24 and <=72 refunds 80%; >72 refunds zero. All threshold fields use minutes; `boundaryMode:UPPER_INCLUSIVE` makes these semantics explicit. Alternatively supply **only** `deductionTiers` with `{minimumMinutesAfterPurchase,calculationType,deductionValue}`; 20 means deduct 20%, unlike `refundPercentage:80`. At least a zero-minute tier is required.

Refundable quantity = purchased quantity minus non-cancelled allocations, forfeited quantity and previously refunded quantity. Completed/no-show allocations do not become refundable merely because another booking was cancelled. Partial-use and expiry permissions come from the purchase snapshot. Expiry uses the package valid-days value captured on that purchase. Eligible money is the remaining original online payment, capped by its proportional share for refundable quantity, rounded down to cents before applying the tier. A successful purchase refund invalidates remaining entitlements and increments refunded quantity once. Existing sold-inventory accounting is preserved; refunds do not invent inventory restock rules.

Group appointment cancellation example:

```json
{
  "isEnabled": true,
  "cancellationAllowed": true,
  "minimumCancellationMinutes": 120,
  "restorationMinimumMinutes": 1440,
  "lateCancellationOutcome": "FORFEITED",
  "expectedVersion": 0
}
```

At least 24 hours before a redemption appointment, cancellation restores its entitlement. At >=2 and <24 hours it forfeits it; below 2 hours cancellation is blocked. `RESTORED` can be chosen for the late interval. No money refund occurs merely from cancelling a redemption. The appointment status releases capacity, while forfeited counters prevent reuse. A purchase refund is a separate preview/request/approval operation.

## Frontend confirmation and payment workflow

1. Display branch policy before checkout. Create a service appointment with the existing `/appointments/pay-now`, `/appointments/deposit` or `/appointments/reserve` endpoint. Group checkout uses the existing body plus explicit branch, or the new checkout endpoint. See [Book Now guide](../BOOK-NOW-STAGING.md) for unchanged payment/QR/salon request bodies.
2. Complete one payment provider. Stripe intent creation alone is not payment success: complete Stripe test checkout and wait for its signed success webhook. Wallet checkout settles synchronously.
3. GET the appropriate preview. Appointment preview exposes `canCancel`, `reason`, `policyVersion`, `cancellationDeadline`, `entitlementOutcome`, `refund` and `previewToken`. Group preview additionally exposes age, quantities and `applicableTier`. Money is numeric HKD; `refund` includes eligible amount, deduction, refund amount, provider destination and approval requirement.
4. If eligible, show the amount/outcome and obtain customer confirmation. POST the exact preview token and a stable key:

```json
{"reason":"Customer requests cancellation","idempotencyKey":"postman-cancel-001","previewToken":"<token from latest preview>"}
```

Execution re-reads current state and the saved terms. Changed amount, tier, time eligibility, allocation, payment or status returns 409; refetch preview and reconfirm. The preview itself makes no writes. A successful service cancellation returns appointment status CANCELLED, refund status PENDING_APPROVAL or NOT_REQUIRED, a nullable refundRequestId and numeric refundAmount. Same-key/same-reason retry returns the recorded result; another reason/resource cannot reuse the key. Group cancellation reports RESTORED/FORFEITED and current remaining quantity. Group refund request returns its existing request record (Decimal amount may serialize as a string), with PENDING status; collection saves `data.id`.

5. For positive money, owner calls existing `PATCH /refund-requests/:id/review` with `{"decision":"APPROVE"}` (or existing REJECT contract), then `POST /refund-requests/:id/process` with `{}`. Read `/refund-requests/:id` or `/refund-requests/my` for progress. Rejection leaves a previously cancelled booking cancelled; it does not restore its slot automatically.
6. Wallet processing commits money restoration, ledger, request completion and policy completion notification/audit in one transaction. Stripe processing persists an attempt before submitting, uses a stable key and verifies identity/amount/currency. A timeout never authorizes another create: retry the same process endpoint for reconciliation. Pending provider refunds can complete via signed `refund.updated` delivery. Unknown/no-unique provider matches need operator investigation; never clear attempt markers or create replacement rows.

The existing cancellation and refund-request creation routes enforce merchant snapshots through shared services. Their paths, methods, middleware and required bodies remain intact. A zero-money service refund request uses the cancellation endpoint instead. Old refundable payment/provider limits still apply to legacy no-snapshot records.

## Acceptance checklist

- Configure each policy with owner and assigned manager; customer and cross-branch manager must fail. Save twice with an old version and expect 409. Public policy JSON excludes internal record ID/timestamps.
- Create fresh PAY_NOW/DEPOSIT/RESERVE_NOW appointments after configuring terms. Preview all tier intervals and exact boundaries; below-cutoff and cancellation-disabled must not cancel. Unpaid Reserve Now cancellation must not create a money refund.
- Confirm positive, zero, fixed and non-refundable cases. Change merchant policy after booking and verify the booked snapshot still applies. A stale preview and another customer's token must fail.
- Verify a Stripe deposit plus salon remainder only refunds eligible online deposit; salon remainder requires separate handling. Verify Wallet paid+bonus balance conservation against the original debit.
- Buy Later without branch when a package has configured policy must fail. Buy with explicit branch, pay once, redeem, cancel early/late, repeat cancellation, and verify capacity/quantity counters. Direct Booking's initial cancellation must still fail.
- Refund an unused group purchase; test partially used permission both ways, expiry snapshot both ways, active booking rejection, 24/72-hour boundaries, zero refund, duplicate request, competing redemption and group provider settlement.
- Owner approval must precede processing. Duplicate Wallet processing must not add credit. Stripe success/pending/failure/timeout and duplicate signed events must not create a second refund or completion notification.
- Importing Postman does not run the requests. Repeat tests with real staging test keys and provider-signed delivery; do not forge unsigned webhook JSON or put secret keys in the collection.

## Migrations and rollout

Cloudflare uses the existing SQLite Durable Object migration chain, not an independent D1 database. v12 is additive: policy format/boundary defaults preserve existing tiers; nullable purchase branch and cancellation idempotency/result fields preserve historical rows. v11 still requires the explicit approved package-to-branch mapping and aborts for unmapped policies. No table reset or singleton rename is a migration strategy. Existing snapshots, balances, constraints and migration checksums must remain intact.

The new PostgreSQL migration is `20261022140000_merchant_policy_execution`. **Do not run the current PostgreSQL chain against production without rehearsal:** the pre-existing `20261022051707_fix_refund_request_decimal_precision` sorts before the policy columns it alters; the working tree also already modifies `20261022121000_policy_schema`. These require migration-history inspection on the actual PostgreSQL environment. No PostgreSQL server is available locally, and this task does not rewrite applied migrations. Prisma schema validation is not migration execution proof.

Run local checks, then review the staging dry-run:

```powershell
npm run test:regression
npm run typecheck
npm run cloudflare:build
npx wrangler deploy --dry-run --env staging
```

After staging backup/mapping review, the existing authorized operator can deploy with `npm run cloudflare:deploy:staging`. This task does not execute that command. No new cancellation/refund flag is needed. Existing `ENABLE_BOOK_NOW_PURCHASE=true` is required only for new Direct Booking checkout; keep it disabled unless explicitly choosing that acceptance test. Local `.env` does not change a deployed Worker's bindings.

Production readiness additionally requires deployed account/bindings/secrets, real signed Stripe delivery, frontend confirmation flows, historical-data review and (if Node/PostgreSQL is used) migration plus multi-process concurrency rehearsal. Passing local SQLite tests does not certify those environments.
