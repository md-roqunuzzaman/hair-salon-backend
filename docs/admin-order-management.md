# Admin Order Management

Read-only APIs, using existing commercial and financial records. No new order model, migration, payment flow, feature-license gate, or public bypass is introduced. Existing Merchant APIs are unchanged.

## Endpoints and authentication

Use the existing access-token/session authentication:

```http
Authorization: Bearer <access-token>
GET /api/v1/admin/orders
GET /api/v1/admin/orders/APPOINTMENT/<appointment-uuid>
GET /api/v1/admin/orders/GROUP_PURCHASE/<purchase-uuid>
```

BRAND_OWNER sees only branches whose `Branch.brand.ownerId` matches the authenticated user, including qualifying historical branch-less purchases described below. BRANCH_MANAGER sees only directly assigned branches through `BranchManagerBranch`. CUSTOMER, STAFF and SUPER_ADMIN are forbidden. Missing authentication returns 401; forbidden roles return 403; absent or unauthorized individual orders return the same 404.

## Commercial coverage

- APPOINTMENT: PAY_NOW, RESERVE_NOW and DEPOSIT appointments without a `groupPurchaseId`. This includes service bookings and historical standard-package bookings.
- GROUP_PURCHASE: all stored purchase records with verified ownership, including BUY_NOW_BOOK_LATER and historical DIRECT_BOOK. No creation or purchase flow is added.
- No implicit payment-status or appointment-status exclusions. Pending, unpaid, partially paid, paid, refunded, cancelled, expired, completed and no-show records remain visible when authorized.
- A voucher purchase is one commercial order. Its redemption appointments, initial/deposit payments, remaining payments, payment attempts, cancellations and refunds are related records, never additional commercial orders.
- Wallet top-ups are wallet funding transactions, excluded from service-order counts. Existing wallet APIs are unchanged.

## Branch-less ownership and exact blockers

`purchaseBranchId` is the authoritative sale branch when present. For an owner, a null purchase branch can be scoped using a **server-captured purchase policy snapshot** containing `engineVersion: 1`, the expected module (`GROUP_REFUND` or `GROUP_CANCEL`), and a resolvable `branchId`. This establishes brand ownership through the existing Branch/Brand/owner relationships; it does not fabricate a purchase branch. Such orders return `branch: null`, `brandId`, and `ownershipEvidence: PURCHASE_POLICY_SNAPSHOT`.

Multiple valid branch references may differ only when their current verified Brand is identical. Conflicting brand references fail closed. Managers never gain access through snapshot-only evidence: they require an assigned, non-null `purchaseBranchId`.

The following cannot be shown securely to an owner using the existing schema:

1. A null purchase branch with no recognized purchase-time snapshot branch.
2. Snapshot branches that no longer resolve, have no Brand, or whose Brand has no matching owner.
3. Conflicting valid snapshot/purchase branch references across Brands.
4. Ordinary appointments whose Branch has no verified Brand owner.

User/customer and Package have no immutable purchase-brand relationship. Customers can transact across Brands. PackageBranch is mutable and may span Brands. Redemption branches identify fulfillment locations and do not prove the original sale's Brand. None of these are used as historical sale ownership evidence. Unrecognized or malformed snapshots cannot establish ownership.

These exclusions are an explicit schema limitation, not a payment/status filter. List responses contain a `coverage` notice. Counts describe authorized, verifiable orders only. Unattributable orders are not counted or listed across tenants, and no cross-tenant exclusion count or identifiers are disclosed. No live/remote data was inspected, so the number of affected deployed historical records is unknown. Resolving missing historical ownership would require separately authorized data remediation or schema work; neither is part of this additive module.

Related appointments are restricted to authorized branches. Financial records attached to an out-of-scope appointment are also withheld, even if the parent purchase is visible. Contradictory parent links, foreign-customer payments and wallet-funding links are excluded from financial views and payment filters. This restriction is declared by the related-record scope fields. Refund allocations are limited to payments visible within that order.

## Query parameters

| Parameter | Meaning |
| --- | --- |
| `page`, `limit` | Defaults 1/20; page 1–100000, limit 1–100 |
| `branchId`, `customerId` | UUID; branch filter uses the actual sale branch, never a snapshot-inferred branch |
| `orderType` | APPOINTMENT or GROUP_PURCHASE |
| `bookingMethod` | Existing BookingMethod enum |
| `paymentStatus` | Stored order-level PaymentStatus, not inferred from payment attempts |
| `paymentProvider` | STRIPE, WALLET or SALON |
| `salonPaymentMethod` | CASH, CARD, FPS, WECHAT_PAY, ALIPAY or OTHER |
| `appointmentStatus` | Appointment's status, or existence of an authorized related redemption with that status |
| `startDate`, `endDate` | ISO 8601 timestamps with timezone; order **createdAt**, inclusive start/exclusive end |
| `search` | Up to 100 characters; order number/id, customer name/email/phone, item name/translations, actual branch name |
| `sortBy` | createdAt (default), updatedAt, amount or orderNumber |
| `sortOrder` | desc (default) or asc |

Provider and salon-method conditions must match the **same** visible payment record. A Stripe payment and a separate salon payment cannot satisfy a fictitious Stripe/FPS combination. Search values and filters are bound parameters; sort identifiers/directions are allowlisted. `%`, `_`, and `!` in searches are treated literally. Database case-folding can differ for non-ASCII Latin text; Chinese text is searched literally.

```http
GET /api/v1/admin/orders?branchId=<branch-uuid>&orderType=APPOINTMENT&paymentProvider=SALON&salonPaymentMethod=CASH&startDate=2026-11-01T00%3A00%3A00%2B08%3A00&limit=20
```

## Response contract

The existing success wrapper is preserved. Lists return `data.items`, `data.pagination` (`page`, `limit`, `total`, `totalPages`) and `data.coverage`. Detail returns one order in `data`. Example list envelope:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Orders fetched successfully",
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 },
    "coverage": {
      "walletTopups": "EXCLUDED_FUNDING_TRANSACTIONS",
      "unverifiedOwnership": "EXCLUDED; see admin-order-management.md for exact ownership rules"
    }
  }
}
```

Each order includes its canonical id/type/number, verified brandId, actual branch or null, customer, booking/payment status, timestamps, amounts, payments and successful refund totals. Appointment orders retain their item-name snapshot, date/time/timezone, nullable staff, cancellation/completion/no-show information and QR verification metadata. Group orders include their existing purchaseFlow, package description fields, quantities, validity snapshot, deposit/balance fields and authorized related appointments. Package names are current catalog data because GroupPurchase has no immutable item-name snapshot; appointment names are captured snapshots. Existing translations are retained.

Amounts are exact **decimal strings**, consistently in both databases. Sorting by amount compares numeric face values, not exchange-rate-adjusted revenue; never sum different currencies. `refundedAmounts` groups successful Refund records by payment currency and counts each Refund id once. Pending/failed refunds, requests and allocations are visible but not added to actual successful refund totals. Stored payment/order statuses are retained even if historical rows disagree. Reservations are not marked paid from assumptions.

Payments retain raw `purpose`, `provider`, `salonPaymentMethod`, status and amount. Stripe means Stripe, not an invented card brand. Salon method null remains null. `stage` is DEPOSIT or REMAINING for explicit appointment purposes. For deposit group purchases whose payments share GROUP_PURCHASE purpose, the settled initial reference, matching currency and stored deposit amount identify the deposit; matching remaining-amount payments are classified separately. Missing evidence returns UNCLASSIFIED. No chronology-based guesses are made. FULL denotes full-payment purpose, never successful settlement.

QR tokens, provider payment/refund identifiers, secrets, password hashes, raw policy snapshots, idempotency keys and refund claims are not returned. Missing historical GroupPurchase order numbers remain null.

## Query strategy and compatibility

A parameterized UNION ALL query applies authorization and filters before global count, sort and page selection. Stable ties use orderType/id. Only selected orders and their related records are hydrated in batches, with no per-order query loop or full-history application merge. HTTP handlers use a repeatable-read PostgreSQL transaction; workerd's existing facade serializes its storage transaction. SQLite timestamp comparisons normalize production ISO text, SQL-default text and historical epoch milliseconds. Its integer money storage is normalized by the existing facade. No shared adapter changes are needed.

The module chooses the existing workerd/SQLite path using the workerd `WebSocketPair` global; Node uses PostgreSQL. Other runtimes are not claimed as supported. Database-side sorting/counting and deep offset pagination can scan matching history because no indexes/migrations are added. Child arrays are complete for the selected orders within authorization scope; exceptionally large individual voucher histories can produce large responses.

## Local verification

No dependency installation or environment-variable changes are required:

```powershell
npm run typecheck
npx tsx --test tests/admin-order/postgresql.test.mjs
node scripts/build-cloudflare.mjs --test
node tests/admin-order/build-worker.mjs
node --test tests/admin-order/sqlite.test.mjs
npm run test:booking
npm run test:group-refunds
npm run test:cloudflare:api
npm run build
git diff --check
git diff --stat
```

The PostgreSQL test requires the locally installed PostgreSQL 18 binaries at `C:/Program Files/PostgreSQL/18/bin`. It initializes a fresh cluster under ignored `dist/`, listens only on localhost on a temporary port with a random synthetic password, materializes the existing schema only in that cluster, and stops it afterward. It does not use DATABASE_URL or any existing database. SQLite tests use ephemeral Miniflare Durable Object storage, existing migrations, the production adapter, real HTTP router/authentication and synthetic fixtures. Their test entry/bundler is not referenced by deployment configuration.

See `admin-order-verification.md` for the recorded results and existing regression blockers. No deployment, commit, push, remote reads/writes, schema edits or changes to existing tests are part of this task.
