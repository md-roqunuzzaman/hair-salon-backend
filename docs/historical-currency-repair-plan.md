# Historical HKD reconciliation — original approval plan

**Execution update, 2026-11-05:** The owner subsequently approved the exact 38-ID repair. It completed at 10:30:19 UTC, with independent read-back and unchanged financial totals. See the [execution and verification report](historical-currency-repair-result.md). Recovery has not been executed. The preparation text below is retained as the original pre-execution record; its pending/no-execution statements describe that earlier checkpoint.

2026-11-05 preparation record. **Execution approval was pending when this plan was prepared.** Its scope is only `GroupPurchase.currency` on the exact 38 IDs listed below/from the manifest. No live action had occurred at that preparation checkpoint.

## Policy and historical boundary

The owner explicitly confirms that every Group Purchase created before the international settings rollout, including FAILED and UNPAID purchases, was denominated in HKD. This is **business-policy attestation**, not independent payment evidence. It supplies the proposed denomination for the orphan without fabricating a Payment or Appointment.

Corroboration: repository checkpoint `d45b2c967be86eedda74360367458da106c9815a`, committed **2026-11-05T02:34:06Z**, retains hardcoded HKD/hkd payment/wallet paths and has no Brand international-settings route. The recorded staging deployment history spans November 4–5; the inspected current deployment is November 5 at 08:25:30. The exact first international rollout instant was not independently established. The source checkpoint is a conservative provenance boundary, not a claimed rollout timestamp.

All 38 approved historical IDs were created **2026-10-18 through 2026-11-03**, before that pre-integration checkpoint. The orphan was created October 22. This matches the owner's attested HKD period. Current Brand currency is not used as historical proof. Any contradictory persisted evidence stops execution.

## Fresh revalidation and classification

Fresh SELECT-only capture: **2026-11-05T09:30:53.986Z**. All 38 exact IDs exist, all currencies remain NULL, and every status/createdAt/updatedAt matches the previous evidence manifest. Payment/Appointment ownership checks pass; all observed Payment, Appointment and Wallet denominations remain HKD. No conflicting currency was found.

| Evidence classification | Count | Proposed currency |
| --- | ---: | --- |
| Settled-payment record evidence | 34 | HKD |
| Appointment snapshot + owner policy | 2 | HKD |
| Pending Payment snapshot + owner policy | 1 | HKD |
| Owner policy attestation only; no linked payment evidence | 1 | HKD |

The policy-only record is **`d9f6c30e-27d3-4b86-bcf8-09f5cf425ae5`**, FAILED, created `2026-10-22T02:25:45.468+00:00`, updated `2026-10-22T02:31:27.783+00:00`. Its proposed HKD value is expressly policy-based. Its absence of financial footprint is not asserted or required by this repair; the reporting guard is not relaxed.

The [exact review manifest](historical-currency-repair-manifest.json) contains all 38 IDs, timestamps, statuses, classifications and linked evidence IDs. Manifest SHA-256: `e6c36108de14781d6069b82b9d57db046645c2a4b857412cf5130b7bf4c41830`.

## Recovery point: verified scope and limitations

The actual store is the existing SQLite Durable Object `hair-salon-backend-staging_SalonDatabase`, singleton `salon-v1`; no D1 database is involved.

A **currency-only logical checkpoint** was freshly captured and encrypted under the current Windows account with DPAPI:

`.maintenance-backups/historical-currency-20261105/before-state.dpapi`

It contains all columns of the exact 38 GroupPurchase rows, table/schema identity, ledger, Brand settings and financial-context projections: 127 Payments, 143 Appointments, four Wallets, 55 WalletTransactions, 14 Refunds, 16 RefundRequests and zero RefundAllocations. These projections support precondition/invariance checks; they are not represented as a complete backup of every column/table/KV entry in the Durable Object.

Plaintext checkpoint SHA-256: **`b67be381f1d1cfa0ef920311e8092683d7d5a3a28966595613f625c872bcaa50`**. Encryption/decryption round-trip and hash comparison pass. A durable local receipt, proposed SQL and manifest are saved beside it. DPAPI recovery requires this Windows account/machine; it is not a portable disaster-recovery backup.

The scoped compensating recovery was rehearsed locally against captured rows using the actual deployed GroupPurchase CREATE statement and ten money-validation triggers. It restores only the original NULL currency values when all guards still match; it never restores an old whole database. Original full row values and financial projections were recovered exactly in that rehearsal.

Cloudflare also supports [native SQLite Durable Object PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api), covering SQL/KV history for 30 days. **No current native PITR bookmark or full-DO disaster recovery point was obtained/verified.** The deployed API does not expose bookmark retrieval. Deploying maintenance or restoring an old whole database is not authorized and is not proposed. This plan's verified recovery mechanism is the limited logical checkpoint plus guarded currency-only compensation. If a native/full-DO checkpoint is required as an additional gate, do not execute until it is independently obtained and verified.

## Exact proposed implementation

Review artifacts:

- [Repair SQL](historical-currency-repair.sql), SHA-256 `401b51f3b6277656300ea1a3f1ebf73b45b295f58bd51b5484dc20019c3de98f`.
- [Recovery SQL](historical-currency-recovery.sql), SHA-256 `6c7bdb6c4e4d98d0663d69b384a3295ba6a537448a254382ea1e94eafaec4c0f`.
- [Exact-ID/provenance manifest](historical-currency-repair-manifest.json).

The repair is **one atomic SQLite statement**, submitted as one query through the existing SQL interface only after approval. It uses a literal 38-ID allowlist; full original rows and financial-context projections are bound parameters, not string-concatenated data. Materialized validation CTEs evaluate preconditions before the UPDATE starts.

Before changing anything it requires:

1. Exactly 38 unique expected IDs, all in the literal allowlist; every target row exists.
2. Every non-currency column matches its captured original value, including status, identity, amounts, relations, entitlements and original timestamps.
3. All 38 are NULL for an initial application, or all 38 are already HKD for a verified no-op replay. A partial NULL/HKD state or any conflicting currency aborts with no assignments.
4. Captured financial-context rows/counts still match. New or changed financial records cause a safe abort; no automatic stale-snapshot overwrite/rebase occurs.
5. No contradictory Payment/Appointment/Wallet denomination, no non-HKD purchase snapshot, and unchanged HK/HKD/Asia-Hong_Kong Brand configuration.

Only the final `SET currency='HKD'` executes, with `currency IS NULL` and the explicit allowlist. No ORM timestamp update, amount/status modification, new evidence record, allocation change or Brand update is part of the statement. The existing GroupPurchase triggers were inspected; the rehearsal includes their validation behavior. The reporting guard, API contracts and application source remain unchanged.

Parameter 1 is the original 38 complete GroupPurchase rows; parameter 2 contains captured financial-context projections. They are derived from the verified encrypted checkpoint. Private review copies are under ignored `node_modules/.cloudflare-test/historical-currency-plan/`; they are not printed or committed with customer/financial details. There is no live repair runner in these artifacts.

Immediately before a separately approved execution, re-read staging identity, deployment/ledger, rows and evidence; verify the checkpoint and artifact hashes. **Any drift or unavailable query service stops the write and requires a reviewed refreshed plan.** Do not silently substitute newer parameter values under this approval. A later optional SQLite-version probe returned HTTP 500; the earlier capture and trigger reads succeeded. SQL-service health and actual server acceptance must therefore be checked again before execution. No repair statement has been submitted as a probe.

Do not automatically retry a timed-out/500 mutation response: its outcome could be uncertain. Read back all targets first. All unchanged NULL means no repair; all HKD with retained non-currency values means committed/replay success; any unexpected mixture/conflict requires investigation. HTTP 200 alone, or zero affected rows without verified idempotency, is not success.

## Expected counts and financial baseline

| Observation | Captured before | Expected after approved repair |
| --- | ---: | ---: |
| Approved target rows | 38 | 38 |
| Target currency NULL | 38 | 0 |
| Target currency HKD | 0 | 38 |
| Target orphan unresolved-currency blocker | 1 | 0 |
| Target status counts | PAID 29; REFUNDED 4; PARTIALLY_PAID 1; FAILED 3; UNPAID 1 | Unchanged |
| Payments / Appointments / Wallets | 127 / 143 / 4 | Unchanged by this repair |
| WalletTransactions / Refunds / RefundRequests / RefundAllocations | 55 / 14 / 16 / 0 | Unchanged by this repair |

Using the current `getPaymentReport()` predicates against the captured persisted data, with the adapter's existing internal hundredths scaling:

| Payment report field | Expected HKD |
| --- | ---: |
| stripePayments | 6,299.80 |
| walletPayments | 5,298.00 |
| refunds | 2,011.40 |
| netPayments | 9,586.40 |

Captured PAID group-purchase sales are HKD **5,695.00**. These are baseline calculations from persisted records, not claims that a live endpoint has returned these numbers. A stale financial snapshot causes the statement to abort; legitimate subsequent transactions require refreshed reconciliation rather than forcing these old totals onto current data.

## Recovery and post-approval validation

Recovery is a **separately approved** compensating statement over the same 38 IDs. It sets only HKD back to the saved NULL value if original non-currency rows and the financial-context witness still match. It is idempotent when already restored. If a later booking, payment, wallet movement, refund, status/timestamp change or other checked financial update occurred, it aborts without changing any row. In that case prepare a fresh narrow recovery review; never use a whole-database rewind to overwrite unrelated post-backup transactions.

After approved repair:

1. Verify returned IDs/count, all 38 currencies and byte/value-equivalence of every non-currency target field. Read back independently of the mutation response.
2. Check all retained financial rows/projections and totals, wallets, refunds and entitlements; verify the exact orphan no longer meets the unresolved-currency predicate and the unchanged guard resolves HKD.
3. Run the reporting-currency tests, TypeScript checks and relevant regressions; compare staging report fields to persisted-record totals, not just HTTP status.
4. Test authenticated report reads and non-mutating booking/wallet/group-purchase reads. Any login/session needed for verification must be handled without exposing tokens. No real payments, refunds, emails or booking changes are needed.
5. Record the execution receipt, before/after hashes, affected IDs and attestation provenance. No schema migration or Worker deployment is required by this data-only repair.

## Preparation verification

**11/11 local SQLite rehearsal scenarios passed**: exact 38 updates; non-currency/totals invariance; replay no-op; conflicting currency rejection; changed target rejection; changed financial evidence rejection; unapproved row preservation; lossless scoped recovery; recovery refusal after a subsequent wallet movement; partial-state rejection; duplicate/missing manifest rejection; changed Brand rejection (related assertions are grouped into eleven test methods).

The rehearsal tests the proposed SQL, captured GroupPurchase schema/triggers and financial projections in isolated local SQLite 3.50.4. Context tables contain only captured projected columns; this is not a full application/FK restoration rehearsal or proof of current native PITR recovery. A remote SQLite-version probe failed with HTTP 500 and was not retried into an extended investigation.

No backend implementation, reporting guard, schema, migration, production secret, delivery flag or live business record changed. Local artifacts and this plan are the only changes. Step 5 execution and Step 6 live/post-repair verification are **not performed** and remain behind explicit approval and the revalidation gates above.

## Exact 38 IDs and provenance

All original currencies are NULL; all proposed currencies are HKD. The policy-only row remains clearly classified rather than relabeled as transaction evidence.

| Purchase ID | Status | Created (UTC date) | Evidence/provenance |
| --- | --- | --- | --- |
| 6bf83fc1-26d4-4085-b3dc-0f37504cf28c | PAID | 2026-10-18 | SETTLED_PAYMENT_EVIDENCE |
| 764c1bab-59e8-4ad5-a7c1-61dd61bd94d1 | PAID | 2026-10-18 | SETTLED_PAYMENT_EVIDENCE |
| 4d81f84b-37ff-4a36-8918-9ef9194a5030 | REFUNDED | 2026-10-19 | SETTLED_PAYMENT_EVIDENCE |
| 3fec171f-4738-41fe-b4dd-b8b3de51feed | PAID | 2026-10-21 | SETTLED_PAYMENT_EVIDENCE |
| 058c08ca-5971-4f7a-beb8-e1442c326075 | PAID | 2026-10-21 | SETTLED_PAYMENT_EVIDENCE |
| 7ccca35d-6f87-4179-a910-e646aed0ca07 | PAID | 2026-10-22 | SETTLED_PAYMENT_EVIDENCE |
| d9f6c30e-27d3-4b86-bcf8-09f5cf425ae5 | FAILED | 2026-10-22 | OWNER_HKD_ONLY_POLICY_ATTESTATION |
| 26b78193-48b4-4575-a4e1-6d53731030b6 | PAID | 2026-10-22 | SETTLED_PAYMENT_EVIDENCE |
| 71e5ec4d-2c85-443a-aff9-c06ba492b1ad | PAID | 2026-10-22 | SETTLED_PAYMENT_EVIDENCE |
| 91422ac4-c42e-4c48-bf6d-8b0e81317758 | PAID | 2026-10-22 | SETTLED_PAYMENT_EVIDENCE |
| c5344eaf-6250-4bb8-b967-c54bed86a50e | PAID | 2026-10-22 | SETTLED_PAYMENT_EVIDENCE |
| a63e6f39-e710-4211-8e92-a5885277ce1d | REFUNDED | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 03a8b09d-278c-4955-8278-7900258d6ada | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 1f54bec8-66dd-45fe-be4b-d039b17b14df | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| d7bb3f20-ad57-43ba-9be6-c1cec96aa7c8 | REFUNDED | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 82b871ff-0a3e-4aa2-971a-5ea45adad7e6 | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 720a6df5-de17-4f42-a8d3-8c59837973b8 | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| e565af0d-0eba-45b1-91d6-7e0d5efad7cf | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 0f742cf8-19b1-4506-bdb7-cf9442d9f3bb | PAID | 2026-10-23 | SETTLED_PAYMENT_EVIDENCE |
| 3d913fc7-0a01-4faa-960f-b4dfbe3af8d9 | PAID | 2026-10-27 | SETTLED_PAYMENT_EVIDENCE |
| a453540c-bdb7-4881-998c-bf14a4ef81b7 | PAID | 2026-10-27 | SETTLED_PAYMENT_EVIDENCE |
| 18547917-d900-4aa4-8d5a-7a0a1bf21c6c | FAILED | 2026-10-27 | APPOINTMENT_SNAPSHOT_ONLY |
| bea9472b-5e33-43f4-88c2-6a1f3859214c | PAID | 2026-10-27 | SETTLED_PAYMENT_EVIDENCE |
| 7dbf6454-952c-4ea6-8222-e21a7d6fdc03 | UNPAID | 2026-10-27 | APPOINTMENT_SNAPSHOT_ONLY |
| 8970754b-e250-4c03-b0d9-b934fcf1b3db | PAID | 2026-10-27 | SETTLED_PAYMENT_EVIDENCE |
| fc9b03e7-6f01-47b1-9d1e-110e8718a41d | PAID | 2026-10-28 | SETTLED_PAYMENT_EVIDENCE |
| f6960877-7ba5-4e6a-bb11-fa4c15d2035a | PAID | 2026-10-28 | SETTLED_PAYMENT_EVIDENCE |
| 147d72b4-2987-4ea6-9b97-6f61d74c20e5 | REFUNDED | 2026-10-29 | SETTLED_PAYMENT_EVIDENCE |
| 2b2228d8-8d26-42f8-b9e5-ff7b0d0bd8fa | PAID | 2026-10-29 | SETTLED_PAYMENT_EVIDENCE |
| 00941e18-e6c6-4949-ab62-68e271cd8d00 | FAILED | 2026-10-30 | PENDING_PAYMENT_ONLY |
| b5fca63e-562a-42aa-b4d7-93328db225bc | PAID | 2026-10-30 | SETTLED_PAYMENT_EVIDENCE |
| b60477f4-77ea-4397-b380-ee1765fe8345 | PAID | 2026-10-30 | SETTLED_PAYMENT_EVIDENCE |
| 0bb04854-621b-41a2-9e51-0c780096a822 | PAID | 2026-10-30 | SETTLED_PAYMENT_EVIDENCE |
| d34fe09f-22b3-4bde-ae3a-5b276e44439c | PAID | 2026-10-30 | SETTLED_PAYMENT_EVIDENCE |
| 68af976f-f711-451d-9d62-f719723880e2 | PARTIALLY_PAID | 2026-10-30 | SETTLED_PAYMENT_EVIDENCE |
| 6b5610f1-e3d1-4313-8800-cacd9c2f6c7e | PAID | 2026-11-03 | SETTLED_PAYMENT_EVIDENCE |
| 7ee82f34-eb82-4ebd-92b9-b0cd06751903 | PAID | 2026-11-03 | SETTLED_PAYMENT_EVIDENCE |
| 80a316c8-8d6c-400f-9216-3c094caa56a3 | PAID | 2026-11-03 | SETTLED_PAYMENT_EVIDENCE |
