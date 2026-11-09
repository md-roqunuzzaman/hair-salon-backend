# Staging reporting currency recurrence — fixed

2026-11-06. **The missing-snapshot production bug is fixed and deployed with explicit approval. The separately approved nine-record currency repair is committed and independently verified.** The historical reporting blocker is zero. No currency guard was disabled.

## Cause and code change

Yesterday's 38 reconciled purchases remained HKD throughout. The current `createGroupPurchase()` read Brand currency inside its transaction but omitted it from `tx.groupPurchase.create({ data: ... })`. Buy Later requests could therefore create an unlinked NULL-currency purchase and immediately block global financial reporting. Expiry changed these purchases to FAILED without supplying the missing denomination.

The production fix is one line in `src/app/module/group-purchase/group-purchase.service.ts`, in the purchase creation data:

```ts
currency: bookingCurrency,
```

The value is the transaction's Brand currency, preserving configured future currencies. No HKD constant, status exclusion, schema migration or guard bypass was introduced. The owner's existing `brand.service.ts` edit was preserved byte-for-byte.

The regression addition in `cloudflare/international.integration.test.mjs` creates an unpaid Buy Later purchase in each of HKD/GBP/USD/JPY, checks persisted currency while no payment/appointment exists, and verifies financial reporting still succeeds with unchanged totals.

## Approved staging deployment

- Version: **`46fc91d8-51c1-4d92-af9d-aa4dd8a03d0c`**, active at 100%; deployment recorded **08:05:48 UTC / 16:05:48 Asia/Shanghai**.
- Exact approved local artifact: **3,762,414 bytes**, SHA-256 `474d6fe7a2a05c7a1f4bab6049af207493bbc9fec6b54281a27e7fcc7dfcfb3e`.
- All **202 bundled first-party sources** matched before deployment; normal production boot and fixture exclusion passed.
- Executed `npx --no-install wrangler deploy --env staging --keep-vars` only after approval. CLI exit 0; upload 7689.99 KiB / gzip 2109.48 KiB.
- Read-back of the active version confirms matching downloaded-source ETag and a currency property in the production purchase-create call. The same Durable Object namespace, all bindings/secret names, Brand settings and v1–v36 ledger checksums remain in place. Staging delivery stays true; production configuration was not changed.

An unrelated staging version change and subsequent restoration occurred during preparation. The initial data-write preflight stopped before submitting anything when the active version differed. This task did not perform those earlier deployment changes. The approved deployment above is the only deployment executed by this task.

## Exact approved data repair

The initial read found seven new NULL-currency purchases. While the old code remained active, two more were created. The owner explicitly confirmed HKD and separately expanded approval to the exact nine IDs below. All nine were FAILED by the final capture and had no directly linked Payment or Appointment. Their denomination is based on the owner's explicit attestation, not an invented payment record or an inference from current Brand settings.

| Approved purchase ID | Change |
| --- | --- |
| `07671dc7-9c05-4dd5-b2f0-a57bb5bed4bc` | NULL → HKD |
| `3af240ee-ce76-4aba-b166-230d898cec2a` | NULL → HKD |
| `4674cc78-3785-4f48-98c7-ebb0744996e6` | NULL → HKD |
| `614fb6b4-8888-4cd0-af46-c731f64241cf` | NULL → HKD |
| `6ecb4872-71c9-4532-a76d-785017cd2231` | NULL → HKD |
| `c07f991a-2026-4bef-bd3e-8066f60659b8` | NULL → HKD |
| `c2d75abb-92ee-428d-b0c2-813f755c09f2` | NULL → HKD |
| `d4193e91-3908-4042-b934-79829651698f` | NULL → HKD |
| `e3ad858a-c695-41e8-b3b9-f89c23cb19df` | NULL → HKD |

Fresh checkpoint: **08:15:44 UTC**. Atomic repair response: **08:17:54 UTC**, HTTP 200, exactly **nine returned IDs / rows_written=9**. Independent read-back: **08:18:47 UTC / 16:18:47 Asia/Shanghai**.

The literal-ID statement validated every target's original non-currency fields, NULL state, financial-context projections, other purchases, Brand and ledger before assignments. Only `GroupPurchase.currency` was assigned. All target amounts, statuses, timestamps, relationships, quantities and snapshots remain unchanged; all 39 other purchases are identical to the fresh baseline. Yesterday's original 38 HKD assignments remain intact.

| Final observation | Result |
| --- | ---: |
| All GroupPurchase rows | 48 |
| Currency HKD / NULL | 48 / 0 |
| Payment / Appointment / Wallet | 138 / 150 / 4, unchanged by repair |
| WalletTransaction / Refund / RefundRequest / RefundAllocation | 62 / 14 / 16 / 0, unchanged by repair |
| Actual unchanged reporting guard on captured persisted rows | HKD |

Fresh pre-repair and post-repair report-predicate totals agree: Stripe **HKD 6,371.80**, wallet **HKD 5,737.00**, refunds **HKD 2,011.40**, net **HKD 10,097.40**. These are compared to today's refreshed baseline; legitimate transactions before that baseline explain differences from yesterday's totals.

## Rejections, recovery and integrity

The first seven-ID SQL was rejected before mutation because the live SQLite expression-depth limit is 100. Independent reads confirmed all seven original rows were unchanged. Balancing the existing AND expressions retained every predicate/token/literal; it did not remove checks. Rehearsals explicitly set the same depth limit and passed all 11 scenarios.

The balanced seven-ID statement then returned zero assignments because regular business activity changed the financial witness and introduced two additional NULL rows. No safety guard was bypassed. After the separate nine-ID approval, a fresh checkpoint/witness and nine-ID statement were prepared and rehearsed. Only that final statement assigned currency.

After the successful nine-ID response, a local backup-receipt filename collision caused the runner to exit nonzero. The already-written primary receipt proved the successful nine-row response. Its backup was saved under a unique nine-ID filename, and the mutation was **not retried**. Independent SQL read-back, totals comparison and live health verification subsequently passed.

Windows CurrentUser DPAPI checkpoints and durable receipts are under `.maintenance-backups/currency-recurrence-20261106/`. Final before-state SHA-256: `646dfa4bceea1da7394e55db09d5accc07fdd48658eec760c30fdc8d8b4828d4`. Executed balanced repair SQL SHA-256: `4ff115f87473368ce05c145b11fb2510c8eb24e27a1e8c1c26ed18d65602237c`. Recovery SQL SHA-256: `2e7bfc00ed362a6656c4260a15bc4708b83e2936b556d92fb62cde51500a7aa2`.

Recovery requires separate approval and matching guards; it changes only the nine currency fields back to saved NULLs. These are scoped logical checkpoints/projections, not a verified full Durable Object/PITR disaster-recovery backup. Never rewind unrelated later transactions or use the rejected unbalanced draft SQL.

## Tests and remaining limits

| Check | Result |
| --- | --- |
| Initial HKD reproduction before the fix | Reproduced missing snapshot/report failures; name filter intentionally excluded other regions. |
| `npm run typecheck` | PASS. |
| Full existing international Worker suite plus four new unpaid-report cases | **49/49 PASS**, disposable SQLite and mocked providers. |
| International utility/report tests | **21/21 PASS**. |
| `npm run cloudflare:check:staging` | PASS, normal build/schema parity and upload dry-run, exit 0. |
| Production artifact/release verification | PASS; v36, 92 unchanged historical migrations and test-fixture exclusion. |
| Exact normal production artifact boot | **2/2 PASS**, outbound calls blocked. |
| Nine-ID atomic repair/recovery rehearsal at depth 100 | **11/11 PASS**: exact scope/invariance, idempotency, conflict/drift rejection and guarded recovery. |
| Live post-deployment HTTP contracts | **9/9 PASS**: four public 200s, five protected expected 401s; nosniff retained, X-Powered-By absent; no observed 500. |
| Independent SQL verification | Exact nine assignments; zero remaining NULL purchases; unchanged fresh financial context and ledger. |

Authenticated financial-report HTTP 200 was not replayed because no existing approved application session was available. The real guard and report predicates were evaluated against independently read persisted projections; the historical-currency 409 condition is removed. The unauthenticated report endpoint correctly remains 401. No token or login session was fabricated.

This emergency scoped change did not rerun the entire aggregate regression pipeline. Earlier complete regression results predate the changed purchase implementation and are not represented as verification of this incident. Existing mixed/unknown-currency guards and the admin configuration safety restrictions remain intact.

No schema, migration, financial formula, S4/S8 implementation, secret or delivery flag changed. Only the one-line production fix, its Worker regression tests and this report were edited relative to task start; the owner's Brand edit remains intact. No manual charge, refund, booking or email was triggered. Normal approved staging cron/delivery and independent business traffic can continue.

Detailed SELECT projections, receipts, rejection diagnostics, SQL and logs are ignored under `node_modules/.cloudflare-test/currency-recurrence-20261106/`; private customer/credential data is not included here.
