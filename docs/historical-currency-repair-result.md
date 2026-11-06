# Historical HKD reconciliation — executed and verified

2026-11-05. The owner explicitly approved only the previously reviewed 38-ID staging repair. One atomic SQL statement completed at **10:30:19 UTC / 18:30:19 Asia/Shanghai**. Independent SELECT read-back confirms exactly **38 GroupPurchase.currency values changed from NULL to HKD**. No other target field changed. The historical reporting-currency blocker is now **zero**; the unchanged production currency guard resolves HKD from the captured persisted data.

## Scope and observed counts

| Table | Records checked | Result |
| --- | ---: | --- |
| GroupPurchase | 38 | All historical NULL currencies repaired to HKD; exact approved IDs only. |
| Payment | 127 | Already HKD; unchanged. |
| Appointment | 143 | Already HKD; unchanged. |
| Wallet | 4 | Already HKD; balances and denomination unchanged. |
| WalletTransaction | 55 | Captured ledger projections unchanged; no missing wallet/payment or linked currency mismatch. |
| Refund | 14 | Denomination derives from required Payment; all linked payments HKD, projections unchanged. |
| RefundRequest | 16 | Denomination derives from Payment; no missing/non-HKD payment evidence, projections unchanged. |
| RefundAllocation | 0 | No rows or changes. |
| Brand / migration ledger | 1 / 36 versions | HK/HKD/Asia_Hong_Kong and all v1–v36 checksums unchanged. |

Only five live tables have a `currency` column: Brand, GroupPurchase, Appointment, Payment and Wallet. GroupPurchase was the sole NULL-currency table. Its 38 rows all predate the verified HKD-only historical boundary; there were no additional/newer GroupPurchase rows requiring a separate repair. Existing non-NULL currencies were never overwritten. Cross-table refund/payment, wallet/payment and appointment/payment checks found no conflicting denominations.

The owner's original HKD-only business-policy attestation supplies the orphan's historical denomination. Its provenance remains owner policy rather than invented payment evidence. The original [manifest](historical-currency-repair-manifest.json), [repair SQL](historical-currency-repair.sql) and [recovery SQL](historical-currency-recovery.sql) are retained byte-for-byte, including their historical draft labels. The [preparation plan](historical-currency-repair-plan.md) records the original review, not an additional unexecuted repair.

## Execution controls and recovery

Before the write, SQL/manifest/checkpoint hashes matched the reviewed plan. DPAPI decryption and SHA-256 verified the original currency-only checkpoint. Fresh reads matched every original target column and all captured financial-context projections, schema, Brand and migration ledger. The active deployment was the approved existing v36-compatible version `f3a81cae-4504-4a3e-8035-a58b0d2d1882` at 100%.

The request submitted the original SQL once, with the original bound parameters. Materialized checks inside that same statement guarded against stale/partial/conflicting state. Cloudflare returned exactly the 38 allowlisted IDs with HKD and `rows_written=38`. No retry was made. Independent reads verified all 38 results and equality of every non-currency target field and all captured financial-context rows.

Recovery remains the original **separately approved** guarded currency-only compensation, not a whole-database rewind. The original before-state and a new after-state are encrypted with Windows CurrentUser DPAPI under `.maintenance-backups/historical-currency-20261105/`; round-trip verification passed. These are scoped logical checkpoints, **not a verified full Durable Object/native PITR backup**. Later financial activity can make the original recovery guards refuse execution; do not bypass them.

Original plaintext checkpoint SHA-256: `b67be381f1d1cfa0ef920311e8092683d7d5a3a28966595613f625c872bcaa50`. Verified after-state SHA-256: `75d926dae2153dcee2e58b53ac92e1e860b285d7f0957e1abeadae2cb570aa37`. Durable local execution receipts are saved beside the encrypted checkpoints.

## Financial invariance and default behavior

Independent SQL using the existing payment-report predicates reproduced the unchanged HKD baseline:

| Field | Before and after HKD |
| --- | ---: |
| stripePayments | 6,299.80 |
| walletPayments | 5,298.00 |
| refunds | 2,011.40 |
| netPayments | 9,586.40 |
| PAID GroupPurchase sales | 5,695.00 |

Brand, Appointment, Payment and Wallet schema defaults remain HKD. New application financial creation explicitly reads Brand settings or preserves the source appointment/purchase/wallet denomination; it does not reassign historical values from current settings. GroupPurchase intentionally has no database currency default: new purchases explicitly snapshot Brand currency. Refund/ledger tables inherit their related payment/wallet denomination rather than requiring a new nullable currency column.

No fallback or business code was added. Current effective settings remain HK/HKD/Asia_Hong_Kong. Existing supported-currency validation, Stripe minor-unit conversion, denomination snapshots and mixed/unknown-currency guards remain intact. Existing configuration safety restrictions also remain: changing currency over existing financial history is rejected; this repair does not enable in-place redenomination or FX reporting.

## Verification

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0. |
| `node --import tsx --test src/app/utils/international-settings.test.ts cloudflare/international-report.test.mjs` | **21/21 PASS**, no failed/skipped/cancelled. |
| Existing reviewed SQL rehearsal, `python node_modules/.cloudflare-test/historical-currency-plan/rehearse.py` | **11/11 PASS**, including invariance, idempotency, drift/conflict rejection and guarded recovery. |
| `node scripts/build-cloudflare.mjs --test` | PASS, normal test build without diagnostic provider stub. |
| `node --test --test-concurrency=1 cloudflare/international.integration.test.mjs` | **45/45 PASS**, disposable SQLite and mocked providers; HKD/GBP/USD/JPY booking, payments, topups, refunds, snapshots, configuration authorization and report guards. |
| Actual currency guard/resolver on independently captured persisted projections | Original snapshot reproduces 409; repaired snapshot resolves HKD; all **38** purchase resolvers agree; synthetic mixed/unknown cases still reject. |
| Non-mutating live HTTP contract probes | **9/9 PASS**: five public 200 responses and four protected expected 401 responses; nosniff retained and X-Powered-By absent. |
| Independent post-write SQL | Exact approved changes, no residual unresolved blocker, unchanged totals/context/ledger; all verification queries report zero rows written. |
| Source integrity / `git diff --check` | All **534** starting nonignored files unchanged through post-repair validation; diff check passes. Only this report and the plan's execution-status notice are subsequently edited. |

The first sandboxed Node test invocation could not spawn (`EPERM`); the permitted rerun passed all 21 cases. An initial multi-query batch and a dynamic schema-inventory SELECT returned query errors before any write; smaller individual SELECTs and a sqlite_master schema read completed the inventory. Expired Wrangler authentication initially stopped execution before the write-attempt marker; refreshing the existing CLI session allowed the fresh preflight to pass. None of these failures was bypassed, and no mutation was used as a probe.

## Remaining verification limits

No existing approved application login session was available. Authenticated financial-report HTTP **200** and frontend rendering were therefore **not replayed**. The persisted-data predicate, real guard and unchanged totals are verified; the report's historical-currency 409 condition is removed. The unauthenticated report endpoint correctly remains 401. No token was fabricated or new live session created to bypass this restriction.

No application source, schema, migration, currency guard, S4/S8 implementation, secret, delivery flag or Worker deployment changed. No manual charge, refund, booking or email was triggered. The previously restored Worker's normal cron/business activity may continue; these are point-in-time checks, not a production freeze or unconditional production-readiness claim. No additional data or application repair is proposed by this inventory.

Detailed safe receipts/logs are ignored under `node_modules/.cloudflare-test/historical-currency-plan/`, including `live-write-receipt.json`, `approved-repair-verification.json` and current test logs. Credential-bearing CLI output and row projections are not included in this public report.
