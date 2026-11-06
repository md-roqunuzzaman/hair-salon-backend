# Tencent moderation Worker compatibility and S6 verification

Local scoped change, 2026-11-05. **The scoped local release gates pass: normal production Worker boot, S6 security tests, the complete original regression pipeline and staging preparation/upload dry-run.** No deployment, live database operation, real provider call, secret update or delivery-setting change is included. This report supersedes the Tencent/S6 and historical-route blockers recorded in the earlier [international integration report](brand-international-integration.md). It is not unconditional production approval.

## Import investigation and production change

The installed `tencentcloud-sdk-nodejs` package's TMS/IMS clients import `common/abstract_client.js`, which imports `common/sse_response_model.js`, which requires `readline`. The original top-level SDK import included this chain in the Worker. Importing just the service client retains the same dependency. The official package documents Node support; no documented Worker-compatible entry point was found in the installed package or [official SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs).

Production moderation now imports only `src/app/lib/tencent-moderation.ts`. This narrow fetch adapter sends signed POST JSON to fixed TMS/IMS HTTPS endpoints, with API version 2020-12-29, the existing region/BizType configuration and no redirect/retry. It signs the exact transmitted body using the documented TC3-HMAC-SHA256 content-type/host variant. Six independent vectors compare its authorization with the installed official SDK signer across both services and UTC date boundaries; the SDK signer is used only by Node tests. See [Tencent TC3 authentication](https://cloud.tencent.com/document/api/213/30654).

Each request has a 10-second deadline covering headers and response-body reading, an AbortController and a 1 MiB response limit. HTTP errors, redirects, malformed UTF-8/JSON/envelopes and Tencent `Response.Error` are failures. Raw provider errors, response bodies, authorization headers and credentials never cross the transport error boundary. Missing credentials fail before network access. Production no longer imports the SDK; its installed dependency and lockfile are retained unchanged.

The shared validator requires `Suggestion` equal to Pass/Review/Block, a nonempty string Label, integer Score from 0 through 100 and a nonempty RequestId. Present classification lists must be arrays and every entry must have correctly typed classification fields. A less restrictive summary than any child classification is rejected. Optional null/empty lists are accepted; image-library SubLabel may be null as documented. Heterogeneous nested `Details` and recognition-only results are not incorrectly treated as classification decisions. No invented score threshold or requirement that every Pass carry Label Normal is added. Contracts: [TextModeration](https://cloud.tencent.com/document/api/1124/51860), [ImageModeration](https://cloud.tencent.com/document/api/1125/53273), [image result types](https://cloud.tencent.com/document/api/1125/53274).

## S6 test migration and preserved behavior

| Previous OpenAI-specific assertion/wiring | Tencent equivalent retained or expanded |
| --- | --- |
| Mock OpenAI moderation SDK method | Mock the fixed Tencent fetch boundary; execute the real TC3 transport, parser, validator and review callers. |
| Valid flagged boolean and boolean categories | Validate Tencent Suggestion, Label, Score and each classification list; assert derived safe/flagged values and existing decision mapping. |
| Null/missing/malformed results and incorrect category types | Invalid Response envelopes, missing/incorrect Suggestion/Label/Score/RequestId/SubLabel, malformed later classifications, inconsistent summaries and provider Error envelopes all reject. |
| Later flagged/malformed results must not disappear | Assess every text/image input and every classification entry; preserve REJECT > REVIEW > PASS priority. |
| Safe/flagged persistence | PASS publishes, REVIEW stays PENDING, REJECT stays HIDDEN, with existing moderation reasons and notification behavior. |
| Provider/network failure | Create/update persist PENDING with the generic unavailable reason. Owner/assigned-manager replies return the same safe 503 and preserve any previous reply; REVIEW/REJECT replies remain 422. |
| Authorization and sensitive-error assertions | Wrong-branch/nonvisible-review checks still precede provider calls; synthetic diagnostic markers never reach public responses or captured logs. |

The prior 38 failing Node S6 cases and two failing Worker S6 cases used obsolete provider assumptions. No cases were skipped, no authorization/persistence/redaction assertion was relaxed, and no review-service business code was changed. Focused coverage also exercises genuine nullable fields, library classifications, rating-only bypass, provider deadlines, oversized responses and TC3 signing.

## Historical route gate

Booking-policy PUT remains BRAND_OWNER only. The checker now explicitly validates the exact old baseline and confirmed current owner-only contract; a Worker HTTP test proves managers receive 403 without changing the policy. Two pre-existing multiline group-policy validator expressions are normalized only after AST validation of the exact single validator argument. Roles, middleware order, controller and all other route checks remain strict. The immutable historical route baseline and all production route files are unchanged.

## Verification and integrity

Evidence and exit records are ignored under `node_modules/.cloudflare-test/tencent-release/`. The full regression command retains every original stage and the normal international suite; no diagnostic-provider flag is used.

| Command/check | Verified result |
| --- | --- |
| `npm run typecheck` | PASS; final transport/response validation included. |
| `npm run test:security` | PASS: 86/86, comprising 60 S6 cases, 17 independent transport/signing/deadline cases and nine existing S7/S8 HTTP cases. |
| `npm run test:cloudflare:security` | PASS: 8/8, including both original S6 HTTP/SQLite cases, the new owner-only policy test, S5/S7/S8/source-isolation tests and the unmodified strict outer-error test. |
| `npm run test:regression` | PASS: 445/445, zero failed/skipped/cancelled; final frozen-snapshot rerun exited 0. |
| `npx --no-install prisma validate --config prisma.config.ts` | PASS; schema validation only, no PostgreSQL operation. |
| `npm run cloudflare:prepare:staging` | PASS: typecheck, normal build/client generation, schema parity, populated v36 atomic rollback/upgrade/repeat checks and release isolation. |
| `npm run cloudflare:check:staging` | PASS: normal build and staging upload dry-run, exit 0; no deployment. |
| `node --test cloudflare/tencent-production.integration.test.mjs` | PASS: 1/1 against the exact final dry-run artifact; real production entry boots and initializes disposable v36 storage, with zero external calls. |
| Historical route checker | PASS: 148 historical contracts, 72 later routes inventoried, no collisions. |
| `git diff --check`, baseline and frozen-source hashes | PASS: all unrelated starting files preserved; 503 non-documentation source/configuration files unchanged throughout final verification. |

Full pipeline TAP breakdown: errors 39; auth 40; SMTP 5; database 7; booking 56; notifications 18; group refunds 23; D1 financial proof 12; merchant email Node 13/Worker 16; business email Worker 7; Worker API 37; Book Now 27; policy Node 37/Worker 42; international utility/report 21/Worker 45. SQLite adapter/migration checks, TypeScript/Node compilation, schema parity and historical route checks are additional non-TAP gates and are not invented as TAP counts.

Every original aggregate stage remains byte-for-byte in the same command string/order. The prior 371-test S4 checkpoint grows to 445 through 66 international utility/report/Worker cases and eight subsequent booking/branch-break/DST cases; none were removed. Relative to the prior composed 504-case international report (445 aggregate + 52 Node security + seven strict Worker security), this change adds 34 Node cases, one owner-only Worker case and one exact production-artifact boot case. Duplicate reruns are not added to distinct coverage counts.

**Final composed coverage: 540 TAP cases passed, zero failed/skipped/cancelled** (445 aggregate + 86 Node security + eight Worker security + one production boot). Node TAP counts include reported parent/subtest cases; they are not individual assertion counts or one single aggregate invocation. The original aggregate command was run twice, with the final run on the frozen source. Focused suites were rerun after the last image-library contract change. An initial production probe failed because the new test harness lacked required R2 configuration; supplying synthetic configuration fixed the fixture without changing production R2 logic. Initial new-test TypeScript callback annotations were corrected before the successful final checks. No application failure was hidden or bypassed.

Final normal Worker: **3,634,089 bytes**, SHA-256 `42988d3cd22a68f7688379e0f4db8af5cc58b5262b3d72756e92e57e76d3a70d`; v36 manifest and 92 unchanged committed historical SQL files. Staging dry-run upload: 7541.96 KiB / gzip 2075.78 KiB including upload artifacts. The final boot test verifies bundled first-party source freshness, unchanged artifact bytes, absent Tencent SDK/diagnostic stub/test fixtures, public Brand timezone/currency and existing HTTP/CORS/security behavior. Existing strict tests verify signed raw Stripe webhooks and outer 404/500 headers. No S4 authentication/session source or S8 implementation was edited; all five pre-existing non-S6 Worker security test bodies remain text-identical. Schemas, migrations, financial/timezone implementation, API routes, dependency definitions/lockfile and delivery flags remain byte-identical to this task's starting snapshot. Staging delivery remains true and production false.

The exact normal production artifact test uses disposable SQLite, synthetic configuration and an outbound blocker. It verifies source-map freshness, absence of SDK/test fixtures, boot, real setup/v36 initialization, public Brand API, CORS/security headers, no external calls and an unchanged artifact hash. `test:cloudflare:production` rebuilds normally before running it. Staging preparation/verifier additionally requires the new transport and excludes SDK/security mock sources. Upload dry-run is packaging verification, not a deployment.

## Exact scoped file inventory

This inventory is relative to the saved start of this task, including the owner's existing international work, rather than HEAD.

| File | Purpose |
| --- | --- |
| `src/app/lib/tencent-moderation.ts` (new) | Fixed-endpoint TC3 fetch transport, bounded response/deadline and safe errors. |
| `src/app/module/contentModeration/contentModeration.service.ts` | Replace SDK calls and validate the actual Tencent response/classification contract. |
| `src/app/lib/tencent-moderation.test.ts` (new) | Seventeen independent signing/transport/deadline cases. |
| `cloudflare/moderation-security.test.mjs` | Convert and expand S6 Node cases while retaining caller/auth/persistence assertions. |
| `cloudflare/runtime/security-fixture.mjs` | Mock Tencent HTTP envelopes instead of the OpenAI SDK; block unmocked provider traffic. |
| `cloudflare/security.integration.test.mjs` | Actual Tencent S6 cases and owner-only policy regression; five existing non-S6 tests remain text-identical. |
| `cloudflare/test-support/node-security.mjs` | Synthetic Tencent configuration for isolated Node tests. |
| `cloudflare/test-support/public-worker.mjs` | Synthetic Tencent bindings for disposable Worker tests. |
| `cloudflare/test-support/tencent-responses.mjs` (new) | Explicit shared synthetic Pass/Review/Block response fixtures. |
| `cloudflare/tencent-production.integration.test.mjs` (new) | Boot and HTTP probe the exact normal production artifact with outbound I/O blocked. |
| `package.json` | Include transport tests in `test:security`; add `test:cloudflare:production`; preserve aggregate stage order and dependencies. |
| `scripts/inventory-routes.mjs` | Exact owner-only/formatting contract checks against the unchanged historical baseline. |
| `scripts/verify-unified-email-release.mjs` | Require the fetch adapter and reject SDK/security fixture sources in production. |
| `docs/tencent-moderation-release.md` (new) | This scoped implementation/evidence/limits report. |
| `docs/brand-international-integration.md`, `cloudflare/README.md` | Dated follow-up referencing this report; retain historical evidence. |

## Limits outside this scoped verification

- Mocked responses and an independent signer oracle do not certify live Tencent credentials, account entitlements, enabled TMS/IMS products, BizType policy, quota, classification accuracy, remote latency or image-fetch accessibility. A future separately approved live provider check is still required.
- The 10-second limit is per text/image request. Timeout, invalid data and provider errors remain fail closed; they do not automatically publish reviews or replies. Oversized otherwise-valid responses also fail closed.
- Production still needs its existing Tencent credentials/configuration. No new secret names, environment variables, package versions or runtime flags are introduced.
- All earlier international limitations remain: legacy-zone fallback, immutable original denominations, blocked mixed reporting, precision/DST restrictions, and no in-place redenomination over history. Existing S4 persistent-revocation/store-failure limitations remain outside this change.
- Local storage/build/HTTP tests do not certify current remote migration ledger/backups, deployed HTTPS/browser policy, provider delivery or production load. No unconditional production-readiness claim is made.
