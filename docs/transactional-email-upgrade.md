# Customer transactional email upgrade

Local implementation and verification, 2026-11-09. No live database queries/writes, migration execution, deployment, secret/environment changes or real customer emails were performed for this upgrade. Integration databases and provider responses were disposable/synthetic.

## Architecture audit

The lifecycle remains: committed business records → `collectBusinessEmailEvents()` → an event payload builder → `renderBusinessEmail()` → `enqueueBusinessEmail()` → stored `EmailOutbox` subject/HTML/text → `processOneBusinessEmail()` / `processBusinessEmailBatch()` → configured merchant transport.

The collector still scans the original six streams (reservation, appointment payment, group payment, cancellation, reschedule notification and successful refund), using the same cursor cutoff, ordering, bounds and error handling. The seven event names and their dispatch eligibility are retained. Reschedules continue to use the existing `Notification.emailIntent.previous` / `target` captured by the booking workflow; no booking mutation was added here.

`enqueueBusinessEmail()` retains its original stable keys and never revives existing skipped/failed/uncertain jobs. The sender, provider selection, SMTP/TLS, outbox delivery leases, retry budgets/backoff, acceptance history and duplicate prevention were not changed. Direct authentication/security emails remain separate and unchanged.

The sole production caller of `renderBusinessEmail()` is the shared enqueue helper in the new payload module. Its previous numeric `EmailDetail` arrays were replaced by named, typed labels and sections. All builders and existing template unit callers were updated together. This is an internal interface, not an HTTP/API/schema change. The original label-index mapping is no longer interpreted anywhere.

## Changed files and functions

| File | Changes |
| --- | --- |
| `src/app/module/brand-email-setting/brand-email-setting.templates.ts` | Reworked `renderBusinessEmail()`; added `EmailBrand`, named `EmailDetail`/`EmailSection`, translated event copy/sections/statuses; added `emailInstant()`; made `emailAppointmentTime()` resolve calendar wall-clock fields through the actual timezone. Existing HTML escaping and currency formatting retained. |
| `src/app/module/brand-email-setting/brand-email-setting.payload.ts` | New module containing the upgraded `enqueueAppointmentEmail()`, `enqueueGroupPurchaseEmail()`, `enqueueRefundEmail()` and shared brand/row/amount helpers. |
| `src/app/module/brand-email-setting/brand-email-setting.events.ts` | Imports/re-exports the three builders; the existing collection implementation remains unchanged. |
| `src/app/module/brand-email-setting/brand-email-setting.test.ts` | Updated renderer callers for typed sections and dynamic brand requirement. |
| `src/app/module/brand-email-setting/brand-email-setting.payload.test.ts` | 37 in-memory presentation/payload tests, including all 21 event/language combinations. |
| `cloudflare/business-email.integration.test.mjs` | Added real local Worker test for changed branding versus immutable queued retry snapshots. |
| `cloudflare/runtime/business-email-fixture.mjs` | Added branding mutation control only for disposable integration fixtures; excluded from production bundle. |
| `scripts/preview-transactional-emails.mjs` | Reproducible synthetic-only preview generator; no database/provider imports or send operations. |
| `docs/email-previews/index.html` and `docs/email-previews/{EVENT}.{LANGUAGE}.{html,txt}` | Preview index plus 21 HTML and 21 plain-text examples. |
| `docs/transactional-email-upgrade.md` | This report. |

The template file had an existing formatting-only working change at task start; its functionality was upgraded as requested. Booking/payment/refund/wallet services, schemas, migrations, outbox processor, sender/providers and security-email files were not modified.

## Seven email formats

| Event | Customer information |
| --- | --- |
| `PAY_NOW_CONFIRMED` | Confirmed booking explanation, actual item snapshot, branch/contact, stylist, six-character booking number, timezone-aware schedule, booking/payment statuses, total and paid amount. |
| `RESERVE_NOW_RESERVED` | Reservation explanation, booking details, total, actual paid amount and due-at-salon balance. Uses actual booking/payment states; does not equate reservation with full payment. |
| `DEPOSIT_RECEIVED` | Reserved appointment details, stored deposit percentage/payment, stored remaining balance and actual payment state. Does not consult today's branch deposit policy. |
| `GROUP_PURCHASE_SUCCESSFUL` | Actual package/snapshot name, purchase instant, quantity, stored unit/total amounts, successful original payment amounts and outstanding balance, actual payment state, voucher totals/availability/allocation/completion counts and purchase-time validity. Direct bookings also include branch, appointment, stylist and booking number. |
| `BOOKING_CANCELLED` | Actual cancelled booking, schedule, cancellation instant/reason, original paid amount and applicable refund requests. Pending/approved/processing/failed requests are labelled as such; provider completion is not inferred from cancellation or one allocation. No refund section for no-refund/zero-refund requests. |
| `BOOKING_RESCHEDULED` | Item/branch/booking number, separate previous and updated schedules and independently resolved stylist names, plus actual current booking status (including Reserved). |
| `REFUND_COMPLETED` | Original item/branch/booking information when available, reliable original payment amount, this refund's actual amount, actual completion instant, method and evidenced destination. Explicitly permits partial refunds without implying a full refund. |

`BUY_NOW_BOOK_NOW` in the requested business terminology corresponds to the repository's `DIRECT_BOOK` enum; the enum/API was not renamed. Buy Later, Direct Book full payment, deposit and Reserve Now flows retain their original behavior. No extra emails/events were introduced for reminders, QR verification, remaining payments, wallet top-ups, reviews, promotions or failed payments.

## Dynamic branding and item names

Admin customization is stored on `Brand`: `name`, `translations`, `phone`, `email`, `primaryColor` and other palette fields. Builders resolve the same singleton tenant boundary used by the existing sender and use `getLocalizedContent()` for the selected language, with configured English/base fallback. The localized configured brand appears in subject, header, signature and footer. The primary color is used only if it is a six-digit hex value; otherwise the approved accent is retained. Contact values are escaped text, not unvalidated links.

There is no website URL field in the audited Brand schema. `logoObjectKey` is private storage metadata; the existing upload service exposes it through a one-hour signed GET URL. No signed credentials/private keys are embedded in emails, and no new public-logo/website setting was invented. The dynamic name header works without an image.

Branding is resolved at generation time and saved in the existing outbox payload. A subsequent admin edit changes new receipts; retries/reconciliation of the same stable key retain their original subject/HTML/text. Existing historical queued content is not rewritten by this upgrade.

Appointments use immutable `itemName` / `itemNameTranslations`. Direct group purchases prefer their original appointment snapshot when present. Buy Later purchases have a package relationship but no immutable item-name snapshot in the audited schema, so they use the real related package and translations. No historical records were changed to manufacture missing snapshots. Branch names use their stored translation JSON. Customer and stylist names are not translated.

## Financial details and refund destinations

All addition/subtraction uses `Prisma.Decimal`; currency presentation uses the existing formatter with the actual transaction currency. Mixed-currency related payments are rejected rather than combined into a misleading summary. Stored deposits/remaining amounts are preferred; arithmetic fallback only subtracts actual stored payment amounts, never recalculates a deposit percentage from current policies.

Stripe refunds are identified from the original `Payment.provider` and described as returning through the original Stripe payment method, without inventing a card, bank or account number. Wallet refunds query actual `WalletTransaction` rows by original payment, refund reference, REFUND type and owning customer. PAID and BONUS credits are summed separately. Their total must match the actual refund amount before a destination split is rendered. Missing/inconsistent ledger evidence raises `EMAIL_REFUND_LEDGER_RECONCILIATION_REQUIRED`; it does not guess a destination or modify funds.

The existing event/key is per successful `Refund` record, including each successful allocation of a multi-source request. A split request can therefore produce multiple original-source receipts; each describes its own refund amount and source. The upgrade does not coalesce events or imply that one successful allocation completes the entire request. A wallet refund receipt can show both paid and bonus destinations in one email.

Internal appointment, purchase, payment, refund/request, customer, ledger and provider IDs are not payload rows. Only an existing valid six-character appointment `orderNumber` is displayed. UUID/provider-ID patterns in free-text details are also removed from new rendered customer content. IDs remain in internal validation/idempotency data as required by the unchanged infrastructure.

## Languages, dates and optional data

All seven subjects, headings, greetings, descriptions, sections, labels, statuses and closing messages support exactly `en`, `zh-CN`, `zh-HK`. The customer's saved language is resolved by `isLanguage()` / `DEFAULT_LANGUAGE`; unsupported values fall back to English. System status localization is restricted to status/method fields so an actual service name such as `CONFIRMED` is preserved verbatim.

An appointment's stored `date` is a UTC-midnight calendar key, not the appointment instant. `emailAppointmentTime()` extracts that calendar key explicitly, resolves start/end wall-clock values through `createDateTimeInTimezone()` and formats them back in the appointment snapshot timezone. It handles end-of-day 24:00 and rejects invalid/ambiguous DST times rather than silently inventing an offset. Real purchase/cancellation/refund/expiry instants use `Intl.DateTimeFormat` with the snapshot timezone when available, otherwise configured Brand timezone. Branch has no separate timezone field in this schema.

Voucher expiry uses `purchasedAt + validDaysSnapshot` with the existing 24-hour-day validity semantics. NULL validity omits expiry. Allocated vouchers count non-cancelled appointments consistently with the existing entitlement flow; completed services are separately labelled Used. Forfeited/refunded quantities reduce availability. These display calculations do not mutate entitlement or inventory records.

Missing optional stylist, contact, booking number, refund section or voucher expiry rows are omitted. Missing required brand/financial evidence fails collection safely using the existing independent reconciliation transaction and logging. No database repair was attempted.

## Verification

| Check | Result |
| --- | --- |
| `npx prisma validate` | PASS; PostgreSQL schemas valid; no connection/migration. |
| `npm run typecheck` (`tsc --noEmit`) | PASS after final source changes. |
| Focused payload/provider/international/refund-policy/security-localization run | 132 tests PASS, zero failed/skipped. Includes 37 new payload tests and all 21 event/language combinations. |
| Final local Worker business-email, Book Now, refund-allocation and merchant-policy integrations | 73 tests PASS, zero failed/skipped; includes new branding/retry snapshot test. |
| Existing auth unit suite | 45 tests PASS. |
| Existing Worker authentication-email and registration-email integrations | 20 tests PASS in the earlier 92-test combined integration run; security source was unchanged afterward. |
| Local production/test Worker builds | PASS. |
| Targeted production bundle/source-map inspection | Upgraded payload module present; email test-control routes, test fixture sources and synthetic branding absent. |
| `git diff --check` | PASS. |
| `npm run test:booking` | FAIL: the existing booking-regression transaction fixture omits `tx.serviceBranch`, but the current service-booking-window guard calls `tx.serviceBranch.findUnique`. This fails before email logic. Neither that booking guard nor its fixture was changed for this task. Therefore the complete repository regression is not claimed green. |
| `node scripts/verify-unified-email-release.mjs` | FAIL at its existing migration-count assertion: expects 37, current repository build includes 38. No migration/verifier changes or bypass were made. Targeted fixture-exclusion inspection above is narrower and does not replace this failed release gate. |

Initial new payload test runs failed because Node's mock tracker cannot replace dynamic Prisma delegate methods, then because a synthetic purchase ID did not match its linked payment. The test harness was corrected to explicitly assign/restore mocked reads and use consistent fixture identities. All 37 final focused tests pass; no production eligibility guard was weakened. Local spawn restrictions required approved execution of native build/test processes. No real SMTP/Stripe operations were used.

Passing selected suites do not certify production load, external mailbox delivery or inbox placement. Rendering previews are generated HTML/text, not screenshots from Outlook/Gmail or live customer mailboxes.

## Preview artifacts and staging assessment

Open [the preview index](email-previews/index.html) for all seven events in all three languages, with HTML and equivalent plain text. Every preview is marked synthetic/sample and contains no live customer data. Regenerate with `node --import tsx scripts/preview-transactional-emails.mjs`.

The requested presentation/payload upgrade is implemented and its focused checks pass. The initial release check had the booking-fixture and migration-count blockers recorded above. The follow-up below supersedes those two blockers. Logo/website availability, missing historical item snapshots and unevidenced historical wallet splits remain explicit data limitations rather than invented content.

## Staging preparation follow-up — 2026-11-09

At the user's request to prepare deployment, two validation-only fixes were made:

- `cloudflare/booking-regression.test.mjs`: added the current default-disabled service-booking-window fixture and its `serviceBranch.findUnique` delegates. Booking services and assertions were not weakened or changed.
- `scripts/verify-unified-email-release.mjs`: updated the exact expected migration count to 38 and added checks for the v38 booking-hours column, booking-window table/composite foreign key and matching Worker metadata. Prior migration SQL/checksum protection and all isolation assertions remain active. No migration files were modified or applied remotely.

Final checks:

| Check | Result |
| --- | --- |
| `npm run test:booking` | PASS: 56 tests, zero failures/skips. |
| Focused transactional payload and existing email unit checks | PASS: 45 tests. |
| `npm run cloudflare:prepare:staging` | PASS: TypeScript, client generation, schema/migration parity, local populated migration tests and complete release verifier. |
| Release manifest | Migration v38; 94 historical migration files unchanged; production fixture isolation passed; Worker 3,812,588 bytes. Staging business delivery true, production false. |
| `npm run cloudflare:check:staging` | PASS: deployment dry-run only; upload 7745.54 KiB / gzip 2121.61 KiB. |
| `git diff --check` | PASS. |

The user opted out of logo images. Optional logo-only code/tests were removed; dynamic brand-name headers remain. No CID/attachment/provider modification was implemented.

The local candidate is ready for a separately requested staging deployment. This is local build/test/packaging evidence, not a fresh live database/provider/inbox audit. No deployment, real email, remote migration, secret or environment modification occurred during preparation. Deploy with the existing `npm run cloudflare:deploy:staging` command when requested.

## Historical wallet refund discovery fix — 2026-11-09

Read-only follow-up identified a compatibility regression: the collector rescans old successful refunds, and a historical wallet credit linked by refund reference had no `paymentId`. Rebuilding that already-SENT refund's payload raised the new strict ledger error before the outbox's existing-job check, rolling back the whole refund scan and preventing a later Stripe refund from being queued. Refund/payment success was unaffected because collection is independent of settlement.

`enqueueRefundEmail()` now returns an existing job for the same tenant/event/refund key before reconstructing historical display details, preserving every job status, attempt count and original payload. For newly generated wallet receipts, it reads actual REFUND credits by the exact refund reference and validates every row's customer, currency, balance type, positive amount and total. A NULL legacy payment link is accepted; a non-NULL conflicting payment link or inconsistent evidence still fails closed. No historical data is rewritten and no terminal job is revived.

Verification: 51 focused payload tests pass, including all seven existing-job states followed by discovery of a later Stripe refund, NULL legacy linkage and six rejection cases. A disposable Worker regression clears a synthetic wallet credit's old linkage, resets the synthetic collector cursor, and confirms that the previously SENT job stays byte-for-byte unchanged while a later Stripe refund queues once, advances the cursor and sends through the mocked provider. The existing all-seven-event replay test and retry/uncertainty fencing test were also rerun. Staging preparation (TypeScript, schema parity, local migration tests, production build and release verifier) passes; production Worker is 3,812,908 bytes. No live data changes, resend, refund operation or deployment were executed for this fix.
