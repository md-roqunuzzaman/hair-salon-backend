# Book Now staging testing

Book Now now has a shared environment-controlled opt-in. Its default is disabled in both Node and Cloudflare. No flag or deployed configuration was enabled by this change. Use Stripe test-mode credentials for staging acceptance.

## Flag and readiness

Set the exact string below only when explicitly choosing to enable staging testing:

```env
ENABLE_BOOK_NOW_PURCHASE=true
```

Node reads `.env`; local Wrangler reads `.dev.vars`. A deployed staging Worker requires its own binding/secret; changing local `.env` does not affect it. One way to set the deployed flag is `npx wrangler secret put ENABLE_BOOK_NOW_PURCHASE --env staging`, entering `true` at the prompt. The updated code must also be deployed through the normal staging deployment command. Neither action was executed as part of this change.

Missing or `false` disables new Book Now creation and Book Now Stripe intent creation. Other spellings are rejected by environment validation; `false` is not truthy-coerced. Existing purchase settlement, QR, wallet collection and refund reconciliation remain available so disabling new checkout does not abandon payments already in flight.

No additional schema migration is introduced by this flag change. The previously added v4-v6 migration chain is still required by Unified Group Purchase. Existing backups, checksum validation, payment attempt fences, canonical settlement identity and initial-cancellation protection remain in place.

The complete regression suite passed during frontend alignment. The final expanded public API suite passed all 18 tests, including signed Buy Later and Direct Booking webhooks, all five payment combinations, policy rejection, concurrent wallet/slot requests and manager branch access. TypeScript checking passed. PAY_NOW, DEPOSIT (configured strictly between 0 and 100 percent) and RESERVE_NOW are ready for an explicitly enabled public **staging test**. Real Stripe test-account delivery and frontend behaviour on the deployed Worker remain acceptance checks, not automatically certified production readiness.

Production Cloudflare build and schema parity passed. Staging dry-run reported `Total Upload: 7093.40 KiB / gzip: 1976.39 KiB`, the expected bindings, and `--dry-run: exiting now.` The CLI remained open afterward and was interrupted; bundle validation completed, but that invocation did not return a clean zero exit. No publish occurred.

## Postman environment

```text
baseUrl = https://hair-salon-backend-staging.icy-dew-e559.workers.dev/api/v1
customerToken = customer's access token
adminToken = BRAND_OWNER access token
packageId = active listed GROUP_PURCHASE_PACKAGE UUID
branchId = branch assigned to that package
staffId = eligible staff assigned to that branch and package
bookingDate = a valid future YYYY-MM-DD date
payNowTime = available HH:mm
depositTime = another available HH:mm
reserveTime = another available HH:mm
purchaseId = response data.purchaseId
appointmentId = response data.firstAppointment.appointmentId
qrToken = token retrieved from appointment QR endpoint
```

Send `Content-Type: application/json`. Use Customer Bearer authorization except the QR and remaining-payment requests described below. Dates/times use Hong Kong time. Use distinct slots or fresh fixtures for each scenario. Branch hours, staff schedule, leave/conflicts, minimum notice, advance window, booking-method enablement and capacity must allow the selected slot.

## PAY NOW

`POST {{baseUrl}}/group-purchases`

```json
{
  "packageId": "{{packageId}}",
  "quantity": 2,
  "purchaseFlow": "BUY_NOW_BOOK_NOW",
  "bookingMethod": "PAY_NOW",
  "branchId": "{{branchId}}",
  "staffId": "{{staffId}}",
  "date": "{{bookingDate}}",
  "startTime": "{{payNowTime}}"
}
```

`staffId` can be omitted for automatic assignment. Expected creation: HTTP 201; purchase and initial appointment PENDING; reservation expiry populated; no QR. The initial appointment status is PENDING_PAYMENT. Amount is unit package price times quantity.

Stripe option: `POST {{baseUrl}}/payments/group-purchase/create-intent`

```json
{ "purchaseId": "{{purchaseId}}" }
```

Expected HTTP 201 with `paymentId`, full purchase `amount` and `clientSecret`. Creating the intent is not payment completion. Complete it through the frontend/Stripe test checkout and verify the signed success webhook reaches `/api/v1/payments/stripe/webhook`.

Wallet alternative, before starting a pending Stripe payment: `POST {{baseUrl}}/group-purchases/{{purchaseId}}/pay-with-wallet`

```json
{ "useBonus": true }
```

After success: purchase PAID; initial appointment CONFIRMED/PAID; no QR; reserved inventory transferred to sold once. Repeating wallet payment must fail without another debit. Repeating intent creation before payment shares the same local payment and client secret. Duplicate success events must not sell inventory or notify twice.

## DEPOSIT

`POST {{baseUrl}}/group-purchases`

```json
{
  "packageId": "{{packageId}}",
  "quantity": 2,
  "purchaseFlow": "BUY_NOW_BOOK_NOW",
  "bookingMethod": "DEPOSIT",
  "branchId": "{{branchId}}",
  "staffId": "{{staffId}}",
  "date": "{{bookingDate}}",
  "startTime": "{{depositTime}}"
}
```

Pay through the same Stripe-intent request or wallet alternative shown above. Deposit is calculated using branch depositPercentage on the entire purchase amount, rounded to cents. Example: unit HK$100.25, quantity 2, deposit 30% gives total HK$200.50, deposit HK$60.15 and remainder HK$140.35.

After deposit success: purchase PARTIALLY_PAID; initial appointment RESERVED/PARTIALLY_PAID; QR available. Additional redemption is blocked. The purchase must not expire as an unpaid payment hold.

Customer retrieves QR: `GET {{baseUrl}}/appointments/{{appointmentId}}/qr`.

Authorized assigned staff, branch manager, or admin verifies: `POST {{baseUrl}}/appointments/verify-qr`

```json
{
  "qrToken": "{{qrToken}}",
  "branchId": "{{branchId}}"
}
```

Appointment becomes CONFIRMED, while purchase remains PARTIALLY_PAID. Verification follows the branch QR time rule.

Admin or authorized branch manager collects remainder: `POST {{baseUrl}}/group-purchases/{{purchaseId}}/remaining-payment`

```json
{ "paymentMethod": "CASH" }
```

Allowed methods are the existing CASH, CARD, FPS and OTHER enum values. Do not send a client-calculated amount. The backend uses the whole purchase remainder. The purchase and initial appointment become PAID; further redemption is now allowed. Before QR, duplicate collection, CUSTOMER/STAFF collection and cross-branch manager collection must be rejected.

## RESERVE NOW

`POST {{baseUrl}}/group-purchases`

```json
{
  "packageId": "{{packageId}}",
  "quantity": 2,
  "purchaseFlow": "BUY_NOW_BOOK_NOW",
  "bookingMethod": "RESERVE_NOW",
  "branchId": "{{branchId}}",
  "staffId": "{{staffId}}",
  "date": "{{bookingDate}}",
  "startTime": "{{reserveTime}}"
}
```

Expected HTTP 201: purchase UNPAID, reservationExpiresAt null; initial appointment RESERVED/UNPAID with QR; inventory sold according to the existing reservation rule. Stripe and wallet upfront payment requests are rejected. Pending-payment cron must not expire it.

Retrieve and verify QR with the same requests above, then use the group-purchase remaining-payment endpoint with `{"paymentMethod":"CASH"}`. It collects the entire purchase total. Only after collection do purchase and initial appointment become PAID and additional redemption become available.

## Further redemption

`POST {{baseUrl}}/group-purchases/{{purchaseId}}/book-appointment`

```json
{
  "branchId": "{{branchId}}",
  "staffId": "{{staffId}}",
  "date": "{{bookingDate}}",
  "startTime": "{{anotherAvailableTime}}"
}
```

The initial Book Now appointment already consumes one entitlement. Quantity 2 allows only one additional non-cancelled appointment. Initial Book Now cancellation remains blocked; do not present it as a supported cancellation/refund policy. Ordinary redemption cancellation retains the existing rules.

## Acceptance checklist

- Missing/false flag returns 422 without creating a purchase, appointment, payment or inventory change. BUY_NOW_BOOK_LATER still works.
- PAY_NOW Stripe and Wallet: full total, confirmed initial appointment, no QR, one inventory conversion.
- DEPOSIT Stripe and Wallet: whole-purchase deposit, RESERVED/partial state, QR, blocked premature redemption, correct salon remainder.
- RESERVE_NOW: no initial charge, no payment expiry, QR followed by full salon payment.
- Invalid booking details, disabled branch methods, inactive/unassigned resources, conflicting slots and capacity exhaustion are rejected.
- Ordinary appointment payment/remaining-payment routes cannot settle a linked group purchase; use group routes.
- Duplicate intent/payment/webhook/salon-collection requests have no duplicate financial or inventory effects.
- Paid/partial/unpaid-reserve purchases survive pending-payment expiry. Expired pending purchases release inventory and initial holds once.
- Late signed Stripe success refunds the expired payment once without resurrecting purchase/appointment.
- Additional redemption requires full payment and includes the initial appointment in its quantity limit.
- Customer and cross-branch role restrictions remain enforced. Initial appointment cancellation remains blocked.
- Test the deployed Stripe endpoint with test keys, valid signatures, success/failure and refund.updated delivery. Offline mocked Stripe tests do not certify provider configuration or live delivery.

Commands: `npm run test:book-now`, `npm run test:regression`, `npm run cloudflare:check`. No real Stripe call is made by these automated tests. Public staging testing readiness does not mean live production or PostgreSQL concurrency has been certified.

## Frontend alignment audit

There are two purchase modes. `BUY_NOW_BOOK_LATER` requires full upfront payment; `BUY_NOW_BOOK_NOW` is labelled **Book Directly**. Booking methods are choices within Direct Booking, not additional purchase modes. Creation already commits purchase, initial appointment and inventory in one transaction. Stripe/Wallet settlement, QR, salon collection, redemption serialization, durable refund attempts and canonical payment identity are retained.

The alignment changes expose missing discovery and checkout state on existing endpoints, reject missing deposit configuration instead of silently charging 10%, explicitly reject non-group packages, and scope manager purchase detail access to a linked appointment in a managed branch. A manager cannot view an unbooked Buy Later purchase through this detail endpoint. Customer ownership and owner access are unchanged.

Changed production files: `group-purchase.service.ts`, new `group-purchase.presentation.ts`, `package.service.ts`, `branch.service.ts`. Tests: `cloudflare/book-now.integration.test.mjs` and the test-only `cloudflare/runtime/integration-fixture.mjs`. No Prisma schema, migration, refund policy or environment default changes are required by this alignment.

## Frontend discovery and state contract

All paths below are relative to `/api/v1`. Success responses wrap the described result in `{ "success": true, "statusCode": 200, "message": "...", "data": ... }`; creation and intent responses use 201. Failed requests have `success: false` and a business message; use the returned HTTP status rather than assuming successful checkout.

1. `GET /packages/:packageId` returns existing localized package/pricing/branch information plus `groupPurchaseOptions` for group packages:

```json
{
  "availablePurchaseFlows": ["BUY_NOW_BOOK_LATER", "BUY_NOW_BOOK_NOW"],
  "staffSelectionRequired": false,
  "buyLaterRequiresFullPayment": true,
  "onlinePaymentProviders": ["STRIPE", "WALLET"]
}
```

Book Directly is omitted from this array when the flag is disabled. Discovery does not guarantee stock, sale eligibility or a free slot; creation revalidates them.

2. `GET /branches/:branchId/booking-policy` returns existing notice, advance, slot, cancellation and QR rules, `allowedBookingMethods`, the actual `depositEnabled` and nullable `depositPercentage`, plus `groupPurchaseBookingMethods` and `staffSelectionRequired: false`. Use **groupPurchaseBookingMethods** for Direct Booking choices. It filters disabled/invalid deposit configurations; other enabled methods remain available. If it contains one method, select that method; otherwise let the customer choose. Missing percentage is exposed as null, never a fabricated 10%.

3. `GET /branches/:branchId/packages/:packageId/staff` lists eligible stylists. `GET /availability?branchId={{branchId}}&packageId={{packageId}}&date={{bookingDate}}` returns slots and `staffSelectionMode`. Add `staffId={{staffId}}` when selecting a stylist. Omitting staffId uses automatic assignment; an available eligible stylist is still required. Keep branch capacity **and** staff schedules/conflicts enabled.

4. `POST /group-purchases` returns the existing `purchaseId`, totals and `firstAppointment`, plus payment action fields and a redemption summary. `GET /group-purchases/:purchaseId` and `GET /group-purchases/my` now expose matching purchaseFlow, bookingMethod, currency, deposit snapshots, payment action fields and firstAppointment. Detail/list firstAppointment includes appointmentId (also id), statuses, branch/staff, date/times and qrVerifiedAt; obtain the secure token from the existing QR endpoint.

| Field | Meaning |
| --- | --- |
| amount | Agreed whole purchase total, unitPrice times quantity, HKD |
| depositPercentage / depositAmount | Persisted DEPOSIT agreement, null for other methods |
| remainingAmount | Original agreed deposit remainder; historical snapshot, not current amount due |
| onlinePaymentRequired / amountDueOnline | Payable pending hold only; full amount or deposit; zero once paid/expired |
| salonPaymentRequired / amountDueAtSalon | Full total for unpaid Reserve Now, remainder for paid Deposit; zero after collection |
| qrVerificationRequired | Salon payment is needed and initial QR has not been verified; false after verification |
| paymentStatus | Persisted purchase status; list also retains existing effectivePaymentStatus/paymentExpired |
| firstAppointment | Null for Buy Later; unified initial appointment for Direct Booking |
| redemption | purchasedQuantity, redeemedQuantity (all non-cancelled allocations), remainingQuantity, canBookAppointment |

`canBookAppointment` expresses payment/quantity eligibility, not a guarantee that a selected branch/slot/package remains bookable. No frontend amount controls the charge. Refetch detail after payment/webhook/QR/salon actions. Do not call ordinary appointment payment endpoints for group-linked bookings.

For quantity 2 at unit price HKD 100.25 and configured 30% DEPOSIT, a creation response contains the following fields (UUIDs and timestamps shown as placeholders):

```json
{
  "purchaseId": "<purchase UUID>",
  "packageId": "<package UUID>",
  "purchaseFlow": "BUY_NOW_BOOK_NOW",
  "bookingMethod": "DEPOSIT",
  "quantity": 2,
  "unitPrice": 100.25,
  "amount": 200.5,
  "currency": "HKD",
  "paymentStatus": "PENDING",
  "reservationExpiresAt": "<five-minute deadline>",
  "depositPercentage": 30,
  "depositAmount": 60.15,
  "remainingAmount": 140.35,
  "onlinePaymentRequired": true,
  "amountDueOnline": 60.15,
  "salonPaymentRequired": false,
  "amountDueAtSalon": 0,
  "qrVerificationRequired": false,
  "firstAppointment": {
    "appointmentId": "<appointment UUID>",
    "appointmentStatus": "PENDING_PAYMENT",
    "paymentStatus": "PENDING",
    "branchId": "<branch UUID>",
    "staffId": "<assigned staff UUID>",
    "date": "<date at UTC midnight>",
    "startTime": "10:00",
    "endTime": "10:30",
    "qrToken": null
  },
  "redemption": { "purchasedQuantity": 2, "redeemedQuantity": 1, "remainingQuantity": 1, "canBookAppointment": false }
}
```

After deposit settlement, detail reports PARTIALLY_PAID, initial RESERVED/PARTIALLY_PAID, online due 0, salon due 140.35 and QR required. After verification, QR required is false. After salon collection both payment states are PAID, salon due is 0 and the one remaining entitlement can be redeemed. PAY_NOW and RESERVE_NOW request bodies and transitions are specified above.

## Buy Later Postman sequence

Create with Customer Bearer token: `POST {{baseUrl}}/group-purchases`:

```json
{ "packageId": "{{packageId}}", "quantity": 2, "purchaseFlow": "BUY_NOW_BOOK_LATER" }
```

Do not send branch/staff/date/time/bookingMethod. At the same example price, response data has purchaseFlow BUY_NOW_BOOK_LATER, bookingMethod null, amount 200.5, currency HKD, paymentStatus PENDING, firstAppointment null, deposit fields null, onlinePaymentRequired true, amountDueOnline 200.5 and redemption `{ "purchasedQuantity": 2, "redeemedQuantity": 0, "remainingQuantity": 2, "canBookAppointment": false }`. Store data.purchaseId.

Pay using exactly one provider: `POST /payments/group-purchase/create-intent` with `{"purchaseId":"{{purchaseId}}"}` and complete Stripe test checkout, or `POST /group-purchases/{{purchaseId}}/pay-with-wallet` with `{"useBonus":true}`. Stripe intent creation alone leaves it pending; signed success settles it. The full 200.5 is due. Pending Stripe intent blocks switching to Wallet.

Poll `GET /group-purchases/{{purchaseId}}` until PAID; firstAppointment remains null, remainingQuantity is 2 and canBookAppointment true. Call the existing book-appointment body shown above twice with distinct available slots. Third allocation must return 409. Before payment, redemption must return 409. Duplicate Wallet payment must return 409 without another debit. Buy Later Stripe retries must not repeat inventory conversion.

## Preserved decisions and limits

- Buy Later deposit/no-payment options remain unsupported. Supporting them needs a separate product decision about entitlement/payment eligibility.
- Direct Booking DEPOSIT supports a configured percentage strictly between 0 and 100. The existing regular policy editor accepts 100, but group checkout requires a positive salon remainder. Such a configuration is excluded from groupPurchaseBookingMethods and rejected explicitly; use PAY_NOW for full upfront payment. Changing the meaning of 100% DEPOSIT across both systems needs a product decision.
- Existing Reserve Now group purchases have no five-minute payment deadline; pending-payment cron does not expire them. This work does not add appointment-time cancellation, no-show inventory release or another reservation lifecycle. Any new release policy requires a separate decision.
- Existing full-unused group refund and initial Direct Booking cancellation restrictions remain. No merchant cancellation tiers or fee policy were added. Existing refund-request creation/approval eligibility inconsistency remains documented in UNIFIED-GROUP-PURCHASE-AUDIT.md.
- A repeated **create purchase** request is a new purchase attempt, not a checkout idempotency key. Disable repeated submit in the UI and retain the returned purchaseId for payment retries. Slot/stock/quantity protection remains server-side.
- Offline tests use real Express, Worker SQLite and HMAC-signed webhook verification with simulated Stripe responses. Real Stripe network delivery, deployed secrets, browser flows and multi-process PostgreSQL behavior still require staging acceptance.

## Cloudflare staging rollout

Run `npm run test:regression`, `npm run typecheck`, then `npm run cloudflare:build` and `npx wrangler deploy --dry-run --env staging`. Keep the existing database singleton and immutable migrations. This alignment adds no migration; the existing chain through v7 must remain intact.

When authorized to enable staging, set `ENABLE_BOOK_NOW_PURCHASE` to exact string `true` using `npx wrangler secret put ENABLE_BOOK_NOW_PURCHASE --env staging`, then run `npm run cloudflare:deploy:staging`. No flag was enabled and no deployment was performed by this task. Complete all three Direct Booking method checklists above plus the Buy Later sequence. Use Stripe test keys and the correct test webhook signing secret; do not manually forge webhook JSON in Postman.
