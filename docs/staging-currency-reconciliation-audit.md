# Staging financial reporting currency audit — read-only

2026-11-05. **One FAILED historical purchase with no linked currency evidence causes the 409.** All 38 GroupPurchase rows have NULL currency; 37 resolve to HKD from their own linked records. No repair was executed and the guard remains intact.

## Live target and schema

- Worker: `hair-salon-backend-staging`. Actual bindings confirm `SALON_DB` is a **SQLite-backed Durable Object**, class `SalonDatabase`, namespace `hair-salon-backend-staging_SalonDatabase`, singleton `salon-v1`. This Worker has **no D1 binding**. Unrelated account D1 databases were not queried.
- The existing singleton was verified against the namespace object list. Queries used its existing object ID; no new object was created.
- Read window: **2026-11-05T08:49:25.958Z–08:59:56.859Z**. Initial/final purchase counts and blocker identity agree. Independent business traffic/cron can continue; this is a point-in-time audit, not an indefinitely frozen database.
- Actual Brand: **HK / HKD / Asia/Hong_Kong**.
- Actual GroupPurchase.currency: TEXT, nullable, **no default**. Appointment.timezone: TEXT, nullable, no default. Payment.currency and Appointment.currency are non-null TEXT with legacy HKD defaults.
- Actual `_Migrations`: contiguous versions **1–36**, all checksums match the local immutable migration definitions. v36 checksum: `e27eaddc2516705a32e1451f167177f53a3054545d1806a39192b0a8fe5efe1f`.
- `cloudflare/migrations/0036_international_transaction_snapshots.sql:2` and `:3` add nullable fields without historical backfill. Legacy NULLs are expected; v36 has applied successfully. The ledger has no applied-at column, so its exact execution time was not inferred.
- Latest observed deployment: **2026-11-05T08:25:30.098071Z**. Retrieved deployed `worker.js`: 4,418,361 bytes; SHA-256 `d6453922185e5f72673ffc398dbe25e7d10810889452805f4613d5b50bc36637`. This is the uploaded/rebundled module, not the pre-upload local artifact. The actual deployed guard and purchase resolver were extracted and checked.

Inspection submitted **17 SELECT statements in four Data Studio query batches**. Every query returned **rows_written=0**. No application login/session, setup, cron, booking, payment, refund, email or migration endpoint was invoked. No UPDATE, DELETE, migration, redeployment, secret or Brand change occurred.

Cloudflare supports this storage through [Durable Objects Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/). The SQL query POST contract was checked against the [official OpenAPI specification](https://github.com/cloudflare/api-schemas/blob/main/openapi.json). These POSTs submitted only read-only SQL; they were not application mutation calls.

## Exact error path

`src/app/utils/report-currency.utils.ts:8` loads Brand settings and globally groups Payment, Wallet, Appointment and GroupPurchase currencies. At `:19`, it counts purchases satisfying:

`currency IS NULL AND no linked Payment AND no linked Appointment`.

At `:20`, any positive count throws **Historical purchase currency requires reconciliation before financial reporting**, HTTP 409. Payment status, customer, branch and report date do not restrict this predicate. A FAILED October purchase can therefore block unrelated recent financial reports. This exact predicate was verified in the deployed Worker, not assumed from local source alone.

Example route trace:

1. `src/app.ts:210`: mounts `/api/v1/reports`.
2. `src/app/module/report/report.route.ts:69`: GET `/payments`, BRAND_OWNER authorization.
3. `src/app/module/report/report.controller.ts:167`: calls `getPaymentReport()`.
4. `src/app/module/report/report.service.ts:1647`: calls `reportingCurrency()` before aggregates.
5. `src/app/utils/report-currency.utils.ts:19`: orphan predicate; `:20`: exact throw.

The exact failing report URL was not supplied; `/reports/payments` is an example trace. The shared guard also runs in branch/service/package/group-purchase/staff/wallet reports (`report.service.ts:39`, `:810`, `:1050`, `:1280`, `:1412`, `:1773`), dashboards (`dashboard.service.ts:28`, `:587`) and branch monetary summaries (`branch.service.ts:2274`, `:2651`). Availability, ordinary appointment details and wallet reads do not all traverse this global gate.

## Exact blocking record

| Field | Observed value |
| --- | --- |
| Purchase ID | `d9f6c30e-27d3-4b86-bcf8-09f5cf425ae5` |
| Status | FAILED |
| Flow / booking method | BUY_NOW_BOOK_LATER / NULL |
| Created | 2026-10-22T02:25:45.468+00:00 |
| Updated | 2026-10-22T02:31:27.783+00:00 |
| Currency | NULL |
| Purchased-at / reservation expiry | NULL / NULL |
| Linked Payment / Appointment records | 0 / 0 |
| Settlement reference / settlement evidence | None / 0 |
| Matching audit records / policy snapshot currency keys | 0 / 0 |

Its original denomination is **not established**. These fields do not prove why it failed or whether any external historical record existed. Today's HKD Brand setting, catalog prices, other purchases and database defaults are insufficient to assign this row's missing currency.

## Affected counts

| Purchase payment status | All purchases | NULL currency | Linked HKD evidence | Exact blockers without evidence |
| --- | ---: | ---: | ---: | ---: |
| PAID | 29 | 29 | 29 | 0 |
| REFUNDED | 4 | 4 | 4 | 0 |
| PARTIALLY_PAID | 1 | 1 | 1 | 0 |
| FAILED | 3 | 3 | 2 | 1 |
| UNPAID | 1 | 1 | 1 | 0 |
| **Total** | **38** | **38** | **37** | **1** |

35 purchases were created in October and three in November. Earliest: 2026-10-18T01:23:15.688+00:00; latest: 2026-11-03T09:50:42.413+00:00. All predate the current observed deployment. This dataset contains no non-NULL GroupPurchase currency snapshot yet.

Global persisted currency observations: **127 Payments HKD, 143 Appointments HKD, four Wallets HKD**. These are observed stored field values, not proof that every historical amount without evidence also used HKD.

The purchases have **40 distinct linked Payment records** and **35 distinct linked Appointments**. All 40 payments are directly linked GROUP_PURCHASE payments: 35 PAID, four REFUNDED, one PENDING. Every inspected linked record's customer matches its purchase. No contradictory currency or additional indirect-only currency was found. Settlement-reference and appointment-payment paths were also checked.

| Confidence tier | Purchases | Proposed currency | Meaning |
| --- | ---: | --- | --- |
| Settled-payment evidence | 34 | HKD | 29 PAID, four REFUNDED, one PARTIALLY_PAID purchase. |
| Appointment snapshot only | 2 | HKD | Intended booking denomination; no successful payment evidence. |
| Pending payment only | 1 | HKD | Intended payment denomination; no settlement evidence. |
| Unresolved | 1 | UNKNOWN | No safe automatic assignment. |

The three weaker candidates are:

- `18547917-d900-4aa4-8d5a-7a0a1bf21c6c`, FAILED; Appointment `0b1d40d3-386b-4ade-acba-5644c75f9460` stores HKD.
- `7dbf6454-952c-4ea6-8222-e21a7d6fdc03`, UNPAID; Appointment `1a75ad41-dbaa-4c52-ad8f-1dff08596d49` stores HKD.
- `00941e18-e6c6-4949-ab62-68e271cd8d00`, FAILED; PENDING Payment `bfb40ec2-d858-43de-92aa-ca6cbabec854` stores HKD.

Payment/Appointment currencies are persisted per-record evidence. Their legacy HKD defaults cannot independently certify what a PSP actually settled. No live Stripe/provider reconciliation was performed. Settled records provide stronger internal evidence than pending/appointment-only records; preserve this distinction in approval review.

## What the Group Purchase customer API returns

`src/app/module/group-purchase/group-purchase.service.ts:810` scopes the list to the authenticated customer, filters and page (default 20). At `:1131`, `getPurchaseCurrencies()` resolves only selected purchase IDs; at `:1226`, that currency is supplied to the presenter. Detail follows the same rule at `:1516`.

`src/app/utils/transaction-currency.utils.ts:33` combines an existing purchase snapshot, if present, with linked Payment/Appointment currencies. Exactly one supported denomination is required. `:49` selects the linked fields; `:51` applies the resolver. **It does not use current Brand currency to fill historical values.** `group-purchase.presentation.ts:35` emits the supplied currency.

Therefore, the historical HKD shown by the customer API is **resolved from persisted linked evidence**, while the purchase's currency column remains NULL. A customer/status/page containing evidence-supported purchases succeeds even though another orphan blocks the global report. Including the orphan in a page/detail also fails closed with the resolver's historical-reconciliation error. The precise customer/filter/page that produced the reported successful response was not supplied and was not replayed via a new login.

## Safe idempotent reconciliation design — no execution

1. Preserve the guard. Obtain a current usable recovery point and approve an exact evidence manifest before writes. Do not blanket-fill HKD, delete a FAILED row, change statuses or change Brand configuration.
2. Propose 34 settled-evidence assignments, three intended-denomination assignments for separate explicit review, and **no assignment for the unresolved row**. The local proposed manifest contains IDs, expected NULL/status/updatedAt, linked evidence IDs and SHA-256 fingerprints. A proposal is not approval.
3. Find dated, row-specific original checkout/import/receipt evidence for the orphan. Its matching audit/policy snapshots provide none. An owner attestation must reference actual historical evidence; repeating today's Brand settings is insufficient. Without evidence, keep this row unresolved and do not promise that existing reports can be restored safely.
4. Before any approved write, freshly re-read the purchase and all linked/direct/settlement evidence. Validate ownership, purpose, supported currency, agreement, status and fingerprints. Changed evidence or a different existing currency requires abort/review.
5. Use a reviewed atomic transaction or equivalent guarded per-row compare-and-set path. Change only GroupPurchase.currency; preserve amounts, statuses, original timestamps, relations, wallet balances, refunds and financial identities. Record before/after/provenance in the approved audit trail. Do not assume Data Studio's multi-query array is a shared transaction.
6. Idempotency: an already-at-target row with matching evidence is a no-op; a conflicting non-NULL currency or changed evidence aborts/requires review. No row outside the approved allowlist changes. Re-read before resuming an interrupted batch.
7. After approval/execution, recheck counts, retained financial fields/timestamps, denomination agreement, report behavior and customer API behavior. Do not cause real charges/refunds to verify a currency-only repair. Recovery must preserve legitimate business changes made after the audit.

**Assigning the 37 evidence-backed candidates alone still leaves the report at 409.** This was confirmed in a memory-only simulation using the actual guard. Finding evidence for the one orphan is the critical path. Excluding FAILED rows or suppressing the guard is not proposed or executed. A different reporting contract requires separate explicit design review and authorization.

## Expected post-v36 behavior or regression?

The nullable migration, persisted-evidence resolver and no-evidence 409 are **intentional post-v36 fail-closed behavior**, confirmed by existing tests. This is not a Brand timezone error, failed migration or necessary sign of a provider failure.

Operationally, the new global gate produces a **reporting-availability regression for this historical dataset** compared with pre-v36 behavior: one non-settled FAILED orphan blocks unrelated denominated totals. The historical reconciliation/release gate remains incomplete. Prior green local tests/builds did not establish that the live historical dataset had all needed evidence. Financial reporting remains blocked after this audit.

## Reproducible read-only queries

Run only against the verified staging Durable Object/singleton using the existing query interface, not an unrelated D1 database:

```sql
SELECT paymentStatus, COUNT(*) AS purchases,
       SUM(CASE WHEN currency IS NULL THEN 1 ELSE 0 END) AS nullCurrency
FROM GroupPurchase GROUP BY paymentStatus;

SELECT g.id, g.paymentStatus, g.currency, g.createdAt, g.updatedAt
FROM GroupPurchase g
WHERE g.currency IS NULL
  AND NOT EXISTS (SELECT 1 FROM Payment p WHERE p.groupPurchaseId = g.id)
  AND NOT EXISTS (SELECT 1 FROM Appointment a WHERE a.groupPurchaseId = g.id);

SELECT version, checksum FROM _Migrations ORDER BY version;
SELECT name, type, dflt_value
FROM pragma_table_info('GroupPurchase') WHERE name = 'currency';
```

## Validation and integrity

- Existing mocked reporting-currency tests: **4/4 PASS**, zero failed/skipped. Command: `node --import tsx --test cloudflare/international-report.test.mjs`.
- Actual guard/resolver dry run against captured projections reproduced the global 409, resolved 37 purchases from linked evidence, rejected the orphan and confirmed that 37 in-memory assignments alone do not unblock reports. No database operation was part of the simulation.
- All 36 live migration checksums match. All 17 SQL query metadata entries report zero rows written.
- Safe projections, exact queries, deployed-function extracts and per-row evidence/fingerprints are ignored under `node_modules/.cloudflare-test/currency-reconciliation-audit/`. Credentials, cookies, tokens and customer names/contact details are not in this report/projections.
- No application code, tests, configs, schemas, migrations, S4/S8, secrets or delivery flags changed. Before/after hashes protect all 528 starting nonignored files. This report is a new documentation artifact only; existing dirty changes are retained.
- Any subsequent mutation requires explicit approval of concrete evidence-supported assignments. No approval is sought to guess the orphan's denomination.

## Per-purchase proposed inventory

Every persisted purchase currency below is NULL. Proposed HKD values are evidence-derived and **not applied**. The local manifest includes full linked evidence IDs and fingerprints.

| Purchase ID | Payment status | Created (UTC date) | Proposed currency | Evidence tier |
| --- | --- | --- | --- | --- |
| 6bf83fc1-26d4-4085-b3dc-0f37504cf28c | PAID | 2026-10-18 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 764c1bab-59e8-4ad5-a7c1-61dd61bd94d1 | PAID | 2026-10-18 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 4d81f84b-37ff-4a36-8918-9ef9194a5030 | REFUNDED | 2026-10-19 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 3fec171f-4738-41fe-b4dd-b8b3de51feed | PAID | 2026-10-21 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 058c08ca-5971-4f7a-beb8-e1442c326075 | PAID | 2026-10-21 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 7ccca35d-6f87-4179-a910-e646aed0ca07 | PAID | 2026-10-22 | HKD | SETTLED_PAYMENT_EVIDENCE |
| d9f6c30e-27d3-4b86-bcf8-09f5cf425ae5 | FAILED | 2026-10-22 | UNKNOWN | UNRESOLVED |
| 26b78193-48b4-4575-a4e1-6d53731030b6 | PAID | 2026-10-22 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 71e5ec4d-2c85-443a-aff9-c06ba492b1ad | PAID | 2026-10-22 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 91422ac4-c42e-4c48-bf6d-8b0e81317758 | PAID | 2026-10-22 | HKD | SETTLED_PAYMENT_EVIDENCE |
| c5344eaf-6250-4bb8-b967-c54bed86a50e | PAID | 2026-10-22 | HKD | SETTLED_PAYMENT_EVIDENCE |
| a63e6f39-e710-4211-8e92-a5885277ce1d | REFUNDED | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 03a8b09d-278c-4955-8278-7900258d6ada | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 1f54bec8-66dd-45fe-be4b-d039b17b14df | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| d7bb3f20-ad57-43ba-9be6-c1cec96aa7c8 | REFUNDED | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 82b871ff-0a3e-4aa2-971a-5ea45adad7e6 | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 720a6df5-de17-4f42-a8d3-8c59837973b8 | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| e565af0d-0eba-45b1-91d6-7e0d5efad7cf | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 0f742cf8-19b1-4506-bdb7-cf9442d9f3bb | PAID | 2026-10-23 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 3d913fc7-0a01-4faa-960f-b4dfbe3af8d9 | PAID | 2026-10-27 | HKD | SETTLED_PAYMENT_EVIDENCE |
| a453540c-bdb7-4881-998c-bf14a4ef81b7 | PAID | 2026-10-27 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 18547917-d900-4aa4-8d5a-7a0a1bf21c6c | FAILED | 2026-10-27 | HKD | APPOINTMENT_SNAPSHOT_ONLY |
| bea9472b-5e33-43f4-88c2-6a1f3859214c | PAID | 2026-10-27 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 7dbf6454-952c-4ea6-8222-e21a7d6fdc03 | UNPAID | 2026-10-27 | HKD | APPOINTMENT_SNAPSHOT_ONLY |
| 8970754b-e250-4c03-b0d9-b934fcf1b3db | PAID | 2026-10-27 | HKD | SETTLED_PAYMENT_EVIDENCE |
| fc9b03e7-6f01-47b1-9d1e-110e8718a41d | PAID | 2026-10-28 | HKD | SETTLED_PAYMENT_EVIDENCE |
| f6960877-7ba5-4e6a-bb11-fa4c15d2035a | PAID | 2026-10-28 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 147d72b4-2987-4ea6-9b97-6f61d74c20e5 | REFUNDED | 2026-10-29 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 2b2228d8-8d26-42f8-b9e5-ff7b0d0bd8fa | PAID | 2026-10-29 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 00941e18-e6c6-4949-ab62-68e271cd8d00 | FAILED | 2026-10-30 | HKD | PENDING_PAYMENT_ONLY |
| b5fca63e-562a-42aa-b4d7-93328db225bc | PAID | 2026-10-30 | HKD | SETTLED_PAYMENT_EVIDENCE |
| b60477f4-77ea-4397-b380-ee1765fe8345 | PAID | 2026-10-30 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 0bb04854-621b-41a2-9e51-0c780096a822 | PAID | 2026-10-30 | HKD | SETTLED_PAYMENT_EVIDENCE |
| d34fe09f-22b3-4bde-ae3a-5b276e44439c | PAID | 2026-10-30 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 68af976f-f711-451d-9d62-f719723880e2 | PARTIALLY_PAID | 2026-10-30 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 6b5610f1-e3d1-4313-8800-cacd9c2f6c7e | PAID | 2026-11-03 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 7ee82f34-eb82-4ebd-92b9-b0cd06751903 | PAID | 2026-11-03 | HKD | SETTLED_PAYMENT_EVIDENCE |
| 80a316c8-8d6c-400f-9216-3c094caa56a3 | PAID | 2026-11-03 | HKD | SETTLED_PAYMENT_EVIDENCE |
