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

Local verification completed: all 131 regression tests passed; the 11-test public Book Now suite passed again with concurrent intent requests; Cloudflare schema/build/deploy dry-run passed. PAY_NOW, DEPOSIT and RESERVE_NOW are ready for an explicitly enabled public **staging test**. Real Stripe test-account delivery and frontend behaviour on the deployed Worker remain acceptance checks, not automatically certified production readiness.

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
