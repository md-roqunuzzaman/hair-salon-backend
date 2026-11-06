# Brand timezone and currency integration — local candidate

## Owner configuration and staging candidate recheck — 2026-11-05

**The backend uses the Brand owner's configured timezone/currency in the tested booking and financial flows, subject to the history/precision safety rules below. The current normal Worker is a locally verified staging deployment candidate.** No production code, schema, migration, secret or delivery setting needed changing during this recheck. This documentation section is the only source-workspace edit. No deployment or live database/provider operation occurred.

`BRAND_OWNER` configures `PATCH /api/v1/brand/international-settings`; managers receive 403. Owner GET on the same path returns the saved configuration; public `GET /api/v1/brand` exposes timezone/currency for frontend formatting. Initial configuration example, before appointments/financial history exists:

```json
{"countryCode":"GB","currency":"GBP","timezone":"Europe/London"}
```

This is Brand-wide configuration. It is not unrestricted switching over existing history or currency conversion. Currency changes return 409 if any Payment, Wallet, GroupPurchase or Appointment exists. Timezone changes return 409 if any Appointment exists. New transactions snapshot the configured values; historical payments/wallets/purchases and scheduled appointments retain their original denomination/zone. Supported ledger precision is zero or two decimals; JPY amounts must be whole units. DST gaps/folds and duration-changing transitions are rejected. Frontend display behavior and live provider support are not certified by these backend tests.

Fresh verification on the current snapshot:

| Command | Result |
| --- | --- |
| `npm run test:international` | PASS: 21 utility/report + 45 real Worker cases, normal provider path without a diagnostic stub. |
| `npm run test:booking` | PASS: 56 cases, including DST availability checks. |
| `npm run test:notifications` | PASS: 18 cases. |
| `npm run test:cloudflare:security` | PASS: 8 cases, including S6 fail-closed persistence, S8 headers and signed raw Stripe webhooks. |
| `npm run cloudflare:prepare:staging` | PASS: typecheck, normal generation/build, schema parity, v36 upgrade/rollback/repeat checks and fixture exclusion. |
| `npx --no-install prisma validate --config prisma.config.ts` | PASS; validation only. |
| `npm run cloudflare:check:staging` | PASS: upload dry-run only. |
| `node --test cloudflare/tencent-production.integration.test.mjs` | PASS: exact normal artifact boots against disposable v36 SQLite, zero external calls. |

The fresh suites report **149 passing TAP cases, zero failed/skipped/cancelled**, with duplicate coverage not added to previous totals. The four owner-API configurations exercised are HKD with `Asia/Hong_Kong`, GBP with `Europe/London`, USD with `America/New_York` and JPY with `Asia/Tokyo`. Coverage includes PAY_NOW/DEPOSIT/RESERVE_NOW, remaining payments, wallet topups, group purchases/vouchers/refunds, local-day reporting, authorization, snapshot retention and history/mixed-currency guards.

All 503 non-documentation files from the previous verified release remain byte-identical. Its complete **445/445 aggregate regression** result therefore applies to the same source; the aggregate was not rerun in this recheck. All 528 starting tracked/untracked nonignored files were unchanged before this documentation update. Git status and hashes were recorded before/after; existing owner changes were preserved.

The rebuilt artifact remains **3,634,089 bytes**, SHA-256 `42988d3cd22a68f7688379e0f4db8af5cc58b5262b3d72756e92e57e76d3a70d`; manifest v36, 92 unchanged committed historical migration files, production fixtures/stub excluded. Upload dry-run: 7541.96 KiB / gzip 2075.78 KiB. Existing delivery flags remain staging true / production false. Evidence and exit records are ignored under `node_modules/.cloudflare-test/international-release/`.

For the subsequent staging release, use the existing `npm run cloudflare:deploy:staging` command after checking the live ledger and a current usable backup. Pending SQLite migrations apply through the existing runner; this preparation has not applied them remotely. Keep the namespace/singleton and a v36-compatible recovery artifact. Live Tencent/Stripe configuration, frontend formatting and deployed behavior remain separate release checks; this is not unconditional production approval.

## Prior implementation and verification checkpoints

**Follow-up, 2026-11-05:** the separate [Tencent moderation/S6 release report](tencent-moderation-release.md) resolves the production boot, S6 and historical-route gates. The normal production artifact now boots locally; final full regression is 445/445, with 86/86 Node security, 8/8 Worker security and 1/1 exact-artifact boot. Staging preparation and upload dry-run pass. Earlier results below describe the original implementation checkpoint and remain historical evidence; the international limitations still apply. No deployment or unconditional production approval is implied.

Original checkpoint, 2026-11-05: release was blocked. Scoped international behavior was implemented and locally tested, but the unchanged Tencent SDK prevented the production Worker from booting. Existing S6 tests and the historical route checker also failed. Packaging/dry-run success alone was not runtime or production approval.

## A. Implementation summary

- 162 relevant implementation/schema/build files read in the static inventory, plus repository-wide currency/time searches and targeted caller/authorization review. This is not a new full security audit.
- 54 files added/modified by this task, including generated metadata, tests and these two documentation files. Pre-existing dirty files were captured before work and preserved.
- 100 named production functions/template functions added or changed, counted by comparing TypeScript AST function text with the saved starting snapshot.
- **504 distinct TAP cases exercised across recorded suites: 464 passing and 40 unresolved after targeted rechecks.** Counts include TAP parent/subtests and exclude duplicate reruns. This is a composed coverage inventory, not a claim of one green aggregate run. Migration, schema, adapter, compiler and route checks are separate.
- New focused coverage: **21 utility/report cases + 45 Worker cases + 2 booking DST cases = 68 cases**, all passing. Worker cases require the explicitly labelled local provider stub while the unrelated production import remains broken.

Baseline HEAD: `d45b2c967be86eedda74360367458da106c9815a`. Starting tracked/untracked nonignored files: 513. No commit, push, deployment or live migration was performed.

## B. Changes made

This inventory compares with the start of this task, not HEAD, so it does not misattribute the owner's existing changes.

| File | Updated production functions | Previous issue, fix and reason |
| --- | --- | --- |
| `cloudflare/README.md` | Schema/build/test/documentation | Documentation: current v36 release limitations and link to this full report; historical entries retained. |
| `cloudflare/booking-regression.test.mjs` | Schema/build/test/documentation | Tests: model actual Brand/break fields in mocks; add two real availability DST cases. Existing assertions remain strict. |
| `cloudflare/international-report.test.mjs` | Schema/build/test/documentation | Tests: four homogeneous/mixed/legacy-evidence/settings-race cases with injected disposable clients. |
| `cloudflare/international.integration.test.mjs` | Schema/build/test/documentation | Tests: 45 real Worker cases across HKD/GBP/USD/JPY, financial flows, local report boundaries and historical isolation. |
| `cloudflare/migrations/0036_international_transaction_snapshots.sql` | Schema/build/test/documentation | Schema: equivalent additive SQLite v36 columns; existing atomic migration runner is unchanged. |
| `cloudflare/prisma/schema.prisma` | Schema/build/test/documentation | Generated: regenerate through the existing generator to include the two nullable snapshot fields. |
| `cloudflare/runtime/book-now-fixture.mjs` | Schema/build/test/documentation | Test wiring: seed correctly denominated synthetic wallets/catalogs, return original intent currency in refund mocks, and provide explicit disposable settings/timestamp controls. |
| `cloudflare/runtime/group-safety-fixture.mjs` | Schema/build/test/documentation | Test wiring: explicitly denominate newly created synthetic purchases as HKD; retain all existing financial assertions. |
| `cloudflare/runtime/international-provider-stub.mjs` | Schema/build/test/documentation | Test isolation only: moderation requests throw unavailable; never certify Tencent or include this module in production. |
| `cloudflare/runtime/migration-fixture.mjs` | Schema/build/test/documentation | Tests: populated v36 atomic-failure rollback, nullable/no-default/no-guess checks, and snapshot retention on repeated initialization. |
| `cloudflare/runtime/model-metadata.json` | Schema/build/test/documentation | Generated: regenerate adapter metadata; money scale and conversion implementation are unchanged. |
| `cloudflare/test-support/public-worker.mjs` | Schema/build/test/documentation | Test wiring: optional initial settings through the real owner API before financial fixtures; existing defaults remain. |
| `docs/brand-international-integration.md` | Schema/build/test/documentation | Documentation: complete scoped implementation, validation, file/function inventory and unresolved release gates. |
| `package.json` | Schema/build/test/documentation | Tests: add normal/explicitly isolated international commands and append the normal international suite after every original aggregate stage. No dependency/version change. |
| `prisma/migrations/20261105060000_international_transaction_snapshots/migration.sql` | Schema/build/test/documentation | Schema: two additive PostgreSQL nullable TEXT columns only; no live execution. |
| `prisma/schema/appointment.prisma` | Schema/build/test/documentation | Schema: add nullable Appointment.timezone, without a default or historical rewrite. |
| `prisma/schema/group-purchase.prisma` | Schema/build/test/documentation | Schema: add nullable GroupPurchase.currency, without a default or inferred backfill. |
| `scripts/build-cloudflare.mjs` | Schema/build/test/documentation | Build: register immutable v36 and an explicitly requested, integration-only unavailable Tencent stub. Production use of the stub flag is rejected. |
| `scripts/check-cloudflare-schema.mjs` | Schema/build/test/documentation | Build: include v36 in disposable SQLite/schema parity checks. |
| `scripts/verify-unified-email-release.mjs` | Schema/build/test/documentation | Build: require v36 metadata/runtime sources and reject the new test-provider source/marker from production; retain historical checksum/flag checks. |
| `src/app/module/admin/admin.service.ts` | `getAdminUserById` | Currency: use Brand denomination only when the customer has no existing wallet; retain actual wallet denomination. |
| `src/app/module/appointment/appointment.service.ts` | `createPayNowAppointment`, `createDepositAppointment`, `createReserveAppointment`, `cancelAppointment`, `rescheduleAppointment`, `verifyQr`, `completeAppointment`, `recordRemainingPayment`, `recordGroupPurchaseRemainingPayment` | Both: retain manual booking logic, add zone snapshots and representability/DST checks; interpret existing bookings in their saved zone and validate original-currency salon payments. |
| `src/app/module/auditLog/auditLog.service.ts` | `getAuditLogs` | Timezone: convert date-filter boundaries using Brand timezone instead of a fixed +08:00 offset. |
| `src/app/module/availability/availability.service.ts` | `getAvailableSlots` | Timezone: exclude nonrepresentable DST starts/ends and duration-changing intervals while retaining capacity, breaks and staff selection. |
| `src/app/module/branch/branch.service.ts` | `getBranchDailySummary`, `getBranchStaffOutput` | Currency: guard and fence daily/staff monetary totals. Existing manual status/business-hours timezone changes are retained. |
| `src/app/module/brand-email-setting/brand-email-setting.events.ts` | `enqueueAppointmentEmail` | Timezone: format appointment and previous-slot details in the persisted appointment zone; event triggers/identities remain intact. |
| `src/app/module/brand-email-setting/brand-email-setting.outbox-validation.ts` | `assessOutboxDelivery` | Timezone: assess schedule freshness in the persisted zone; no generation, retry, retirement or delivery-flag change. |
| `src/app/module/brand-email-setting/brand-email-setting.templates.ts` | `emailAppointmentTime` | Timezone: label details with the supplied IANA zone and remove misleading Hong Kong-specific field captions. Existing Intl currency formatter remains unchanged. |
| `src/app/module/brand/brand.service.ts` | `getBrand`, `updateBrandInternationalSettings` | Both/policy: expose public international fields additively; allow initial configuration only when safe history conditions hold, inside Serializable settings updates. |
| `src/app/module/cancellation-refund/cancellation-refund.service.ts` | `funding`, `loadGroupRefundBatch`, `appointmentEvaluation`, `groupEvaluation` | Both: preserve payment/purchase currency in previews and funding checks, reject unrepresentable zero-decimal outcomes, and use appointment zone for cutoffs. |
| `src/app/module/cancellation-refund/policy-management.service.ts` | `getPolicy` | Currency: public current policy terms report Brand denomination; policy save/version/boundary rules are unchanged. |
| `src/app/module/cancellation-refund/policy-refund.execution.ts` | `validatePolicyRefund` | Both: validate original-currency amounts and evaluate saved appointment cutoff in its zone without changing tier calculations. |
| `src/app/module/cancellation-refund/policy.calculation.ts` | `appointmentTime` | Timezone: appointmentTime accepts a zone; production callers supply the saved zone. Existing cents/money/evaluatePolicy arithmetic is preserved. |
| `src/app/module/dashboard/dashboard.service.ts` | `getBrandDashboard`, `getBranchDashboard` | Both: Brand-local instant boundaries, correct currency labels, homogeneous totals and a final settings fence; appointment calendar-key filters remain UTC-normalized. |
| `src/app/module/group-purchase/group-purchase.presentation.ts` | `presentGroupPurchase` | Currency: present the supplied persisted/resolved purchase denomination instead of hardcoded HKD. |
| `src/app/module/group-purchase/group-purchase.service.ts` | `createGroupPurchase`, `getMyGroupPurchases`, `getGroupPurchaseById`, `createGroupPurchaseAppointment`, `recordGroupPurchaseRemainingPayment` | Both: snapshot new purchase currency and appointment timezone; retain voucher/deposit/capacity rules, resolve historical denominations without guessing, and preserve original-currency remaining payments. |
| `src/app/module/notification/notification-reminder.service.ts` | `sendAppointmentReminders` | Timezone: search calendar keys covering all zones, then use each saved zone for the existing one-hour reminder window and idempotency identity. |
| `src/app/module/notification/notification.templates.ts` | `POLICY_REFUND_COMPLETED`, `REFUND_REQUEST_APPROVED`, `REFUND_REQUEST_REJECTED`, `APPOINTMENT_REMINDER`, `REMAINING_PAYMENT_RECEIVED`, `DEPOSIT_RECEIVED`, `WALLET_TOPUP_SUCCESS`, `LATE_APPOINTMENT_REFUND`, `GROUP_PURCHASE_SUCCESSFUL`, `LATE_GROUP_REFUND`, `REFUND_COMPLETED` | Both: optional reminder zone plus currency-appropriate decimal display in en/zh-CN/zh-HK; preserve legacy defaults and event meanings. |
| `src/app/module/payment/late-group-refund.ts` | `validateLocal`, `ensureLateGroupPurchaseRefund` | Currency: late refunds and provider verification use original Payment.currency wire units; existing attempt fences and keys remain unchanged. |
| `src/app/module/payment/payment.service.ts` | `createStripeIntent`, `handleStripeWebhook`, `createGroupPurchaseStripeIntent`, `createGroupPurchaseRemainingStripeIntent`, `handleGroupPurchaseStripeEvent`, `handleGroupPurchaseRemainingStripeEvent`, `refundWalletPayment`, `createAppointmentRemainingStripeIntent` | Currency: all intent/webhook/remaining/refund boundaries use original denomination and proper Stripe units; top-up credits validate wallet denomination and representability. |
| `src/app/module/refund-request/refund-allocation.plan.ts` | `groupRefundFunding`, `validateAllocationPlan` | Currency: validate original purchase denomination and allocation representability; retain allocation/idempotency logic. |
| `src/app/module/refund-request/refund-allocation.processing.ts` | `walletRefund`, `verify`, `stripeRefund` | Currency: Stripe allocations use correct wire units; wallet split credits must be representable before persistence. |
| `src/app/module/refund-request/refund-request.processing.ts` | `createHongKongDateTime`, `verifyApprovedStripeRefund`, `processApprovedRefund`, `reconcileApprovedStripeRefund`, `processApprovedWalletRefund` | Both: saved-zone cutoff evaluation, original-currency Stripe create/reconciliation, and exact wallet paid/bonus credit checks; existing attempt/claim boundaries are preserved. |
| `src/app/module/refund-request/refund-request.service.ts` | `createHongKongDateTime`, `createRefundRequest`, `reviewRefundRequest` | Both: use saved zone for legacy refund cutoffs and reject unrepresentable request amounts; original approval/access rules remain. |
| `src/app/module/report/report.service.ts` | `getBranchReport`, `getServiceReport`, `getPackageReport`, `getGroupPurchaseReport`, `getStaffReport`, `getPaymentReport`, `getWalletReport` | Currency: guard/fence all monetary reports without inventing FX rates or changing existing total calculations. |
| `src/app/module/staff/staff.service.ts` | `getMyAppointments` | Timezone: classify staff upcoming/history using Brand-local date/time; schedule/unavailability calendar-key logic is retained. |
| `src/app/module/wallet/wallet.service.ts` | `getMyWallet`, `getMyTransactions`, `createTopup`, `deductWalletBalance`, `payAppointmentWithWallet`, `payGroupPurchaseWithWallet`, `payAppointmentRemainingWithWallet`, `payGroupPurchaseRemainingWithWallet` | Both: new wallets/topups use Brand currency with Serializable creation checks; existing wallet payments retain saved currency, reject mixing, and use Brand-local history filters. |
| `src/app/utils/appointment-timezone.utils.ts` | `appointmentTimezone` | Timezone: prefer the persisted appointment zone; retain guarded legacy Brand fallback without backfilling history. |
| `src/app/utils/brand-international-settings.utils.ts` | `getBrandInternationalSettings` | Both: accept the existing transaction client so settings reads participate in financial creation transactions. |
| `src/app/utils/brand-timezone.utils.ts` | `createDateTimeInTimezone`, `assertTimezoneDuration`, `localDateBoundary` | Timezone: validate calendar input, reject DST gaps/folds and inconsistent elapsed duration; compute instant filter boundaries from local midnights. |
| `src/app/utils/international-config.utils.ts` | `validateCurrencyCode` | Currency: reject ISO currencies whose precision the existing ledger cannot represent safely. |
| `src/app/utils/international-settings.test.ts` | Schema/build/test/documentation | Tests: 17 focused timezone, DST, precision, historical snapshot and localized-label cases. |
| `src/app/utils/report-currency.utils.ts` | `reportingCurrency`, `assertReportingCurrency` | Currency: reject mixed/unknown totals and fence initial settings changes after report calculations. Optional client injection enables isolated regression checks. |
| `src/app/utils/transaction-currency.utils.ts` | `currencyDigits`, `assertCurrencyAmount`, `stripeAmount`, `assertSameCurrency`, `historicalPurchaseCurrency`, `getPurchaseCurrency`, `getPurchaseCurrencies` | Currency: separate internal hundredths from Stripe wire units, reject fractions/mismatches, and resolve historical purchase currency from persisted evidence. Batch list resolution avoids new N+1 queries. |

## C. Already correct and preserved

- `getDateInTimezone` retains its existing implementation. Appointment date-only keys, UTC weekdays and UTC-normalized calendar filters remain calendar labels, not local-midnight instants.
- Existing manual PAY_NOW/DEPOSIT/RESERVE_NOW staff resolution, capacity/break checks, pricing/deposit formulas, Serializable retry behavior, order numbers and notifications were retained. Only snapshot/precision/time interpretation guards were added.
- Appointment `getMyAppointments`, detail/list projection functions, `resolveAvailableStaff`, staff/capacity assertions and `completeEligibleAppointments` were not rewritten. Auto-completion still uses actual QR time plus service duration and the existing eligibility conditions.
- Branch `updateBranchStatus` and `updateBusinessHours` manual Brand-local date changes remain intact. Staff schedule/unavailability calendar keys and overlap rules are unchanged.
- `wallet-payment-ledger.ts`, `refund-request.policy.ts`, `evaluatePolicy`, `cents` and `money` keep their original allocation/tier/boundary semantics. Internal hundredths are intentionally retained; they are not assumed to be Stripe minor units.
- Existing `emailMoney` already used Intl with the supplied currency. Merchant routing, provider credentials, outbox identities/leases, no-platform-fallback policy and triggering events are unchanged.
- Absolute created/updated/paid/refunded/hold/expiration timestamps remain UTC. Promotion/banner/package ISO timestamp inputs remain absolute timestamps. Voucher validity still uses its existing elapsed-day rule.
- Remaining Hong Kong/HKD literals are legacy defaults/recovery text, preserved HKD minimum rules, comments/seed copy and unrelated country-specific validation. All first-party appointment, purchase, wallet and Payment creation sites were searched; new financial operations no longer select hardcoded HKD.
- No routes, roles, controllers, S4 session/authentication sources or S8 error/header implementation were changed. The owner-only branch booking-policy route already existed before this task and remains unchanged despite the historical checker failure.

## D. Database changes and safe configuration

Existing wall-clock appointment fields do not record their original zone, and GroupPurchase had no immutable denomination. Two nullable snapshots are the smallest additive solution:

```sql
ALTER TABLE "Appointment" ADD COLUMN "timezone" TEXT;
ALTER TABLE "GroupPurchase" ADD COLUMN "currency" TEXT;
```

Both PostgreSQL and SQLite use these statements. **There is no default and no historical UPDATE/backfill.** Old rows remain NULL. PostgreSQL schema validation ran; no PostgreSQL migration was applied or rehearsed against a live database. SQLite v36 was tested on populated disposable databases with injected rollback and repeated startup. New non-NULL snapshot writes survive repeat initialization.

Existing SQL files, including the owner's pending Brand v35 migrations, remain byte-for-byte unchanged. The final source hash check protects 127 selected historical migration/security/configuration files. The release verifier separately checks 92 committed historical migration files and prior manifest checksums.

- New appointments store Brand timezone. Existing snapshots win over current Brand settings.
- Legacy appointment zones use the existing Brand configuration as a compatibility fallback; no original offset is invented. Timezone changes are rejected while any appointment history exists. Databases already changed externally require verified historical reconciliation.
- New purchases store Brand currency. Legacy purchase currency is accepted only when persisted payment/appointment evidence is unambiguous; missing or contradictory evidence returns 409. Current Brand currency never supplies a guessed historical purchase denomination.
- Owner initial currency configuration is allowed only with no Payment, Wallet, GroupPurchase or Appointment records. Currency changes with existing history remain 409. This is a deliberate safety restriction, not unrestricted in-place redenomination.
- Settings updates and new wallet bootstrap use Serializable transactions; topup wallet creation rechecks the same settings inside its transaction. Existing debit/refund transactions are retained. Reports check denomination before totals and fence initial currency changes after calculations.
- No new environment variables or secrets are required. Existing staging delivery remains true and production false; neither flag was changed.

For a future separately approved release, retain the existing namespace/class/singleton, verify current ledger/recovery state and apply only pending migrations through the existing runner. Workers never use PostgreSQL migration SQL. Retain a v36-compatible recovery artifact; an older strict migration checker is not an automatic rollback target.

## E. Tests and validation

Evidence logs and exit files are ignored under `node_modules/.cloudflare-test/international-integration/`; no real SMTP, Stripe charge/refund, Tencent request or remote database operation is part of these checks.

| Command / suite | Result |
| --- | --- |
| `npm run typecheck` | PASS, including the final configuration-fence changes |
| `npm run build` | PASS, Node TypeScript output |
| `npx --no-install prisma validate --config prisma.config.ts` | PASS, validation only |
| `npm run test:international:isolated` | PASS: 21 utility/report + 45 real Worker cases; explicit test-only unavailable moderation provider |
| `npm run test:booking` / aggregate booking stage | PASS: 56, including two added availability DST cases |
| Existing Node/proof aggregate stages | PASS: errors 39, auth 40, SMTP 5, database 7, booking 56, notifications 18, late/group refund safety 23, D1 proof 12, merchant-email unit tests 13 = 213 |
| `npm run test:policy` | PASS: 37 |
| `npm run test:security` | FAIL: 14/52 pass, 38 S6 failures; existing OpenAI-specific mocks/expectations do not validate the current Tencent implementation. Tencent credentials were cleared in this test process to prevent real calls. S7/S8 HTTP checks pass. |
| Existing Worker suites + international + strict security suite, explicit provider stub | Initial 170/173 pass. One synthetic group fixture lacked its new currency field; corrected and the affected real runtime case passed, including 71 internal SQLite group checks. Two S6 cases remain failed. After the eight additional final international cases, composed Worker coverage is 179/181, not a single green normal-provider run. |
| `npm run test:regression` | FAIL: stops at 13 Worker bootstrap failures caused by Tencent's node:readline import. Later aggregate stages are not silently counted as passed. The original stage order is preserved; the normal international suite is appended after the historical route check. |
| `npm run cloudflare:prepare:staging` | PASS: final source typecheck, generation, schema parity, populated v36 rollback/upgrade/repeat checks and artifact isolation |
| `npm run test:cloudflare:database` | PASS: disposable SQLite transactions, exact hundredths, uniqueness mapping, sessions and row-lock translation |
| `npm run cloudflare:check:staging` | PASS: upload dry-run only, no deployment |
| Actual final production Worker boot in disposable Miniflare | FAIL: `No such module "node:readline"`, imported from rebuilt `worker.mjs` through the unchanged Tencent SDK |
| `node scripts/inventory-routes.mjs` | FAIL on pre-existing booking-policy PUT owner-only permission versus old owner/manager baseline. Audit also exposes two pre-existing group-policy validator formatting differences; baseline/checker/routes were not changed to hide them. |
| `git diff --check` and protected-file hashes | PASS; source integrity evidence retained |

The 18-file conditional Worker run included runtime auth/booking/wallet, remaining payments, banner carousel, branch breaks, registration verification, login limiting, password change, S4 sessions, Book Now, merchant policy, refund allocations, capture reconciliation, merchant/auth/default/business email, S5/S6/S7/S8 security and international cases. The two S6 assertions were not weakened. The initial fixture failure was fixed by supplying an explicit denomination to new synthetic data; unknown historical currency remains rejected in production and is tested separately.

Initial mocked booking failures were resolved by supplying actual Brand/break fields in fixtures, not by adding production fallbacks. Sandbox spawn denials were rerun with local execution permission. No failed application test is reclassified as a pass because packaging succeeded.

Final artifact evidence: v36, Worker JavaScript **3,680,556 bytes**, SHA-256 `9ab24798002cb1cd5938b71be59160d5cebc05ba112a71f86ee6ce5a17f77270`. All **201 bundled first-party sources** match their current files. All **29 API route files**, dependency definitions and package-lock remain unchanged from the starting snapshot; every original regression stage remains in its original order. Production excludes the diagnostic provider stub. The final unmodified production bundle was boot-probed again and still fails on node:readline.

To reproduce the explicitly conditional Worker coverage locally after normal client generation, use:

```powershell
$intlWorkerFiles = @(
  'cloudflare/runtime.integration.test.mjs',
  'cloudflare/remaining-payment.integration.test.mjs',
  'cloudflare/banner-carousel.integration.test.mjs',
  'cloudflare/branch-breaks.integration.test.mjs',
  'cloudflare/registration-email.integration.test.mjs',
  'cloudflare/login-rate-limit.integration.test.mjs',
  'cloudflare/password-change.integration.test.mjs',
  'cloudflare/auth-session.integration.test.mjs',
  'cloudflare/book-now.integration.test.mjs',
  'cloudflare/merchant-policy.integration.test.mjs',
  'cloudflare/refund-allocation.integration.test.mjs',
  'cloudflare/capture-reconciliation.integration.test.mjs',
  'cloudflare/email-provider.integration.test.mjs',
  'cloudflare/auth-email.integration.test.mjs',
  'cloudflare/email-defaults.integration.test.mjs',
  'cloudflare/business-email.integration.test.mjs',
  'cloudflare/security.integration.test.mjs',
  'cloudflare/international.integration.test.mjs'
)
node scripts/build-cloudflare.mjs --test --international-provider-stub
node --test --test-concurrency=1 $intlWorkerFiles
```

This command keeps the S6 failures visible. It does not validate production Tencent compatibility and is not a replacement for the failing normal regression/production boot checks.

## F. Remaining risks and release blockers

1. **Production Worker boot:** the existing Tencent SDK imports node:readline under the current compatibility/runtime configuration. The production moderation source is identical to the starting snapshot. Fix its Worker compatibility in a separately scoped change; the diagnostic stub is never a deployment substitute.
2. **Moderation verification:** 38 Node and two Worker S6 cases remain unresolved. Existing OpenAI mocks do not certify Tencent classification or caller failure contracts. Do not infer security correctness or provider availability from these international tests.
3. **Historical route check:** owner-only booking-policy permission predates this task; confirm the intended contract before a reviewed checker update. Do not restore manager permission merely to turn a test green. Two other raw validator-string differences are formatting-only, also pre-existing.
4. **DST model:** there is no stored fold/offset or immutable scheduled UTC start/end. Ambiguous/nonexistent times and intervals whose elapsed duration differs from the configured wall-clock duration are rejected. Midnight transitions may also reject a date filter. Original rules/offsets for unknown legacy rows and future TZ database changes are not certified.
5. **Configuration transitions:** this does not unlock timezone/currency changes over existing history. External direct Brand edits bypass safety guards and require audited reconciliation; tests use such edits only in disposable fixtures to prove snapshot behavior.
6. **Precision:** validated ledger precision is zero or two decimals, not every ISO currency. JPY prices, deposits, promotions and refunds must be whole units. Fractional computed deductions or paid/bonus refund splits are blocked rather than rounded or converted. Existing catalog/policy decimal APIs remain; incompatible values must be corrected by the owner before successful checkout/refund.
7. **Stripe:** account/country presentment support and settlement-dependent minimums still require provider sign-off. HKD's existing minimum guards are retained. Other currencies are sent in correct units and the provider enforces account-specific limits. ISK/UGX whole-unit special wire handling is explicit. See [Stripe currency and minor-unit rules](https://docs.stripe.com/currencies).
8. **Wallet/reporting:** one denomination per wallet remains mandatory. A wallet cannot pay an appointment in another denomination. Financial reports conservatively reject any mixed or unresolvable denomination globally, including branch reports; no FX/bucketed-total API was invented.
9. **External gates:** no live ledger/backup/upgrade rehearsal, actual provider/inbox test, deployed HTTPS/browser behavior or production load certification occurred. Existing S4 database/session-store failure limitations remain outside this task. Country-specific phone validation and branding are unchanged; countryCode does not make those unrelated rules international.

## G. Compatibility confirmation

All API method/path definitions, roles, scope checks, booking/payment status transitions, voucher validity and inventory rules, QR conditions, payment/refund identity keys, wallet paid/bonus allocation formulas and financial ledger precision are retained. Existing absolute UTC timestamps and appointment calendar keys are not rewritten.

The public Brand GET gains additive countryCode/currency/timezone fields. New 409 guards explicitly reject unknown historical denomination, mixed totals, unsupported precision, currency changes with history, and in-flight initial-configuration report changes. Unsafe DST slots are excluded/rejected. These are the intentional safety restrictions; this is not full unrestricted international readiness.

The normal regression pipeline still includes every original stage. The isolated provider flag is diagnostic only. No frontend, dependency version, secret, deployment setting, live record, S4 session implementation or S8 header/error implementation was modified. No deployment, real email, real charge/refund, commit or push occurred.
