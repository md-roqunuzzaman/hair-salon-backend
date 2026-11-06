# Cloudflare deployment

## Tencent moderation and S6 follow-up — locally verified, 2026-11-05

The normal production Worker now uses a fixed-endpoint TC3-signed fetch adapter instead of the Tencent SDK's unsupported readline import chain. It boots in disposable Miniflare without a diagnostic stub. Actual Tencent Pass/Review/Block contract tests retain fail-closed review/reply persistence, authorization and generic errors. Final checks pass: 445 full-regression cases, 86 Node security cases, eight Worker security cases and one exact production-artifact boot case, with zero failed/skipped/cancelled. TypeScript, Prisma validation, v36 schema/migration/isolation checks, staging preparation and upload dry-run pass. See [the exact changed files, test results and remaining limits](../docs/tencent-moderation-release.md).

This supersedes the Tencent/S6/route-check blockers in the original international checkpoint below. No deployment, live database, real provider request, schema/migration change, secret or delivery-setting change occurred. Staging delivery remains true and production false. Live Tencent configuration/entitlements/policy/accuracy and remote release/recovery checks remain unverified; passing local checks is not unconditional production approval.

## Brand international settings — v36, local candidate 2026-11-05

Brand-configured timezone/currency paths now use safe transaction snapshots, original payment denominations, proper Stripe units and mixed-currency/report guards. New nullable Appointment.timezone and GroupPurchase.currency columns do not backfill history. Existing history still restricts administrator currency/timezone changes. See the complete [implementation and validation report](../docs/brand-international-integration.md).

**Original checkpoint (superseded by the follow-up above):** the Tencent SDK imported node:readline and the production Worker failed local boot. S6/provider tests and the historical booking-policy route check were unresolved. The diagnostic international provider stub remains test-only and is never a rollout workaround. The separate scoped fix above establishes normal-artifact runtime verification; existing international limitations and live-release requirements remain in force.

## Schema lookup indexes — v32, local preparation 2026-11-02

SQLite `0032_branch_location_outbox_lock_indexes.sql` mirrors the owner's new Prisma indexes: `Branch(status, latitude, longitude)` and `EmailOutbox(status, lockedUntil)`. It creates two non-unique indexes only; no rows, credentials, delivery history, financial values or constraints are rewritten. v1-v31 remain immutable. Build registration, generated Worker schema, schema parity and the release verifier include v32.

Disposable migration tests verify exact index columns, an injected failure after index creation rolling back both indexes and the migration ledger, preservation of every existing application-table row, successful recovery, stable repeated initialization and foreign keys. Existing historical migration checks remain in place. Preparation passed TypeScript, client generation, fresh SQLite schema parity, v32 populated upgrade/recovery and production fixture isolation.

The two existing PostgreSQL candidate folders are retained verbatim: `20261102082512_email_outbox_stale_lock_index` is empty and `20261102083831_email_outbox_stale_lock_index` creates the outbox index. Their names alone do not mean the index is created twice. No PostgreSQL history was edited or applied. The new Branch index has no accompanying PostgreSQL migration in the current workspace; prepare that separately before a Node/PostgreSQL rollout. Workers use only the SQLite v32 migration.

**Scope is schema readiness only.** The owner confirmed application edits are still ongoing and requested a separate schema report. The full regression started during preparation was interrupted after that scope clarification and is not a passing combined-release result. The independently run 52 Node security tests passed their checked snapshot; they do not certify subsequent application edits. Preserve all shared changes, finish them and rerun full regression/security/preparation on a stable snapshot before approving deployment. The generated artifact/manifest is packaging evidence, not full production approval.

Use `npm run cloudflare:prepare:staging` and `npm run cloudflare:check:staging` for local checks. These do not deploy. A separately approved rollout must preserve the existing namespace/singleton, verify a fresh usable backup and live ledger, then let Worker initialization apply only pending SQLite versions. After v32, retain a v32-compatible recovery artifact; an older migration checker rejects the newer ledger. Index creation can add startup work proportional to live table size, which disposable tests do not measure.

No live database, deployment, secret or delivery-setting change is included. The existing staging delivery flag remains true and production false. Evidence is ignored under `node_modules/.cloudflare-test/schema-index-release/`.

## S8 outer Worker error headers — locally verified, 2026-11-02

The outer-error release blocker is fixed in `runtime/errors.mjs`. `failureResponse()` adds the same five headers as Express Helmet: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, and `Cross-Origin-Opener-Policy: same-origin`. Error normalization, redacted JSON bodies, status codes and content type are unchanged. No CORS, cookie, CSP or CORP policy is added to outer responses. Express middleware and Stripe handling are unchanged.

The original strict test in `security.integration.test.mjs` is byte-for-byte unchanged (SHA-256 `118ee99331551bf2b3f105340f56419530347db6c3ac9026a441dc3cc3e9cf6c`). It now passes for blocked internal 404, unauthenticated setup 404 and a test-only simulated binding-failure 500. New `outer-error-security.integration.test.mjs` additionally checks exact header values against Express, unchanged JSON/redaction/content type, absent outer CORS/cookies/CSP/CORP, current helper inclusion and exclusion of synthetic failure/security fixtures from production.

| Final local check | Result |
| --- | --- |
| `npm run typecheck` | Passed; also repeated during staging preparation |
| `npm run test:security` | 52 passed |
| `npm run test:regression` | 371 passed, including 40 auth and 33 real Worker API tests; 148 historical route checks passed |
| `npm run test:cloudflare:security` | Original 7 passed |
| `node --test cloudflare/security.integration.test.mjs cloudflare/outer-error-security.integration.test.mjs` | Final packaged-artifact check: 9 passed, including the original 7 and 2 new checks |
| `npm run cloudflare:prepare:staging` | Passed; v31 upgrade/rollback/repeat checks, 91 unchanged historical SQL files and bundle isolation |
| `npm run cloudflare:check:staging` | Passed; upload dry-run only, 7592.78 KiB / gzip 2082.71 KiB |

There are **432 distinct passing TAP tests** (371 + 52 + 9), zero failed/skipped/cancelled in the final runs. Repeated executions and auth tests already inside regression are not counted twice. All previous regression suites remain included. Real local Worker tests retain credentialed Express CORS, security headers and response envelopes; a whitespace-preserving signed Stripe webhook succeeds and tampered signatures fail without an extra ledger write. A source-map comparison matched all 191 first-party production sources to current files; Worker JavaScript is 3,656,217 bytes. Test controls remain excluded.

An initial sandbox run could not spawn test processes; it was rerun with the required local process permission. An intermediate artifact check correctly failed when an external `user.service.ts` edit made the saved bundle stale. The owner confirmed a freeze; current user changes were preserved, rebuilt and retested without weakening assertions. External banner/carousel edits were also preserved and are present in the final source map. Those user/banner changes are not S8 implementation changes. This task changes only the production error helper, the new focused test file and this documentation. Existing S4 auth/session sources, schemas, migrations, business/payment code, secrets and delivery flags were not edited by this task.

Evidence is ignored under `node_modules/.cloudflare-test/s8-outer-headers/`, including final test logs/exit codes, original/frozen source hashes and artifact/preservation checks. No generated Worker was manually edited. No deployment, live database operation, real provider call or real email occurred. Checked-in staging delivery remains its previously approved `true`; production remains `false`.

This resolves the local S8 blocker, not full production readiness. HTTPS redirects/browser HSTS enforcement, real deployed headers, edge logging and browser OAuth/media behavior remain release-time checks. The known S4 password-update/session-revocation storage-failure and concurrent-login limitations remain as documented below; no credential-epoch/schema redesign is included. A current usable backup, live migration ledger, merchant readiness/backlog review and separate deployment approval are still required before rollout. The earlier blocked result below is retained as historical evidence and is superseded by this S8 verification.

## Combined S1–S8 verification — 2026-11-02: release blocked by S8

The requested combined local verification and staging packaging completed without deployment or live-resource changes. **The combined result is not green: 429 of 430 unique checks passed; one strict Worker S8 regression fails.** This run supersedes the earlier pending-rebuild status below: the production Worker has now been regenerated through the normal scripts and its current source verified. No production business/authentication code, schema, migration, secret or delivery setting was changed during this combined task.

Original audit IDs are retained. S1 is **Missing Login Rate Limiting (High)**. S2 is **Vulnerable Production Dependencies — 11 Security Advisories (High)**; eleven describes the original finding, not the current audit count.

| ID | Current scoped verification | Result |
| --- | --- | --- |
| S1 | Seven real Worker login limiter cases: account/IP budgets, concurrency, expiry, restart, forwarded-header resistance and login-cleanup failure | PASS |
| S2 | Fresh official npm production audit, exit 0; zero known vulnerabilities; lockfile preserved | PASS |
| S3 | Existing forced-password-change restrictions, own-password/logout exceptions and concurrent changes | PASS |
| S4 | Eleven real Worker session cases plus Node auth: matching sid/jti, exact-valid rotation, expiry, logout/user-wide revocation, failure injection and restart | Functional PASS; persistent-revocation limitation remains |
| S5 | Node byte-boundary/security tests and new real Worker registration/change/reset ASCII/Unicode tests, including accepted 72-byte registration | PASS for existing policy |
| S6 | 43 focused Node cases plus real Worker HTTP/SQLite create/update/reply persistence, malformed results and provider failures | PASS |
| S7 | Node and real Worker secret-marker logging tests; OAuth code/state handling, query/header/cookie/body redaction, current-source artifact comparison | PASS for application logging |
| S8 | Express/Worker normal API responses, parser/auth errors, credentialed CORS, preflight and signed/tampered raw Stripe bodies | PARTIAL: outer Worker errors lack headers |

Confirmed open S8 failure: `cloudflare/runtime/errors.mjs` returns `Response.json(body, { status: body.statusCode })` without the security headers. Both `cloudflare/worker.mjs` and the Durable Object use this helper for errors outside Express, so Helmet does not execute on those paths. The strict new test reproduced missing X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Strict-Transport-Security and Cross-Origin-Opener-Policy on public-blocked `/__internal/cron` (404), unauthenticated GET `/__setup` (404), and a simulated outer binding failure (500). The 500 injection uses the existing **test-only** `/__worker-error` fixture; this is not a production API. Error status/envelopes remain intact and X-Powered-By remains absent. The test is neither skipped nor weakened and `test:cloudflare:security` correctly exits 1. Product code was left unchanged for a separate fix/review. The minimal follow-up is to apply the same existing header policy to Worker-created error responses while preserving their body/status and rerun this boundary test. Do not claim a combined security release pass merely because packaging succeeds.

| Command/check | Current result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run test:security` | 52 passed |
| `npm run test:auth` | 40 passed; also included in the full regression |
| `npm run test:regression` | 371 passed; zero failed/skipped/cancelled; exit 0 |
| `npm run test:cloudflare:security` | 7 checks: 6 passed, 1 failed; zero skipped/cancelled; exit 1 |
| `npm run cloudflare:prepare:staging` | Passed: typecheck, build/schema parity, disposable v31 upgrade/rollback/repeat checks, immutable history and fixture exclusion |
| `npm run cloudflare:check:staging` | Passed; Wrangler dry-run only, no upload/deployment |
| `npm audit --omit=dev --registry=https://registry.npmjs.org` | Passed: zero known production vulnerabilities, exit 0 |
| Historical route contracts | 148 checked; no method/path collisions |

The previous 371-test suite is unchanged, not reduced: all 33 pre-existing npm script strings are preserved, including the full regression command. Its TAP groups remain 39/40/5/7/52/18/23/12/13/16/7/33/27/37/42. The separate Node security suite contributes 52 additional checks and the new Worker/security suite contributes seven (six HTTP cases and one artifact check). Thus unique combined coverage is **371 + 52 + 7 = 430**, with **429 passed and one failed**. The separately repeated 40 auth checks are not counted twice. An initial artifact-test path-resolution error was corrected to resolve source-map paths relative to the map directory; strict source-content comparison remains. The genuine S8 failure persists.

Artifact verification matches all 14 selected current source files for the application, rate limiting/IP adapter, password guards, S4 auth/session services/adapter, moderation and logging against the rebuilt production source map. Test controls and security/session fixtures are excluded. Worker JS is 3,655,751 bytes; staging dry-run upload is 7592.28 KiB / gzip 2082.52 KiB. v31 and the 91 checked immutable historical SQL files remain unchanged. The production artifact manifest is regenerated by the existing verifier, not manually edited.

Protection/evidence: git status and byte copies/hashes of 479 existing source/configuration/documentation files were captured first under ignored `node_modules/.cloudflare-test/combined-s1-s8/`. Existing production source, auth/session files, migration/schema files, the dependency lockfile, namespace configuration and delivery flags are preserved. Checked-in staging EMAIL_OUTBOX_ENABLED remains true under its prior authorization; production remains false. This does not independently verify remote settings. Changes in this verification task are test-only `cloudflare/runtime/security-fixture.mjs`, `cloudflare/security.integration.test.mjs`, opt-in capture/control wiring in `cloudflare/runtime/integration-fixture.mjs`, one new `test:cloudflare:security` command in `package.json`, and this report. Outbound OpenAI is additionally blocked in the disposable fixture; no real email, Stripe charge/refund or provider test was initiated.

Remaining release limitations: S8 outer-response headers are an open blocker. The documented S4 cross-store password-update/revocation failure and concurrent-login race still need durable credential/session-version enforcement for hard revocation guarantees; reset-token cleanup failure can leave a token usable until its TTL. Legacy access tokens without sid require reauthentication or valid refresh and frontends must serialize refreshes. Real HTTPS/HSTS enforcement, browser OAuth popup/media behavior, infrastructure log retention/access controls, current live ledger/recovery point and the enabled staging email backlog/provider state remain release-time checks. Mocked provider tests do not certify real credentials, remote availability, classification accuracy or inbox delivery. No deployment, live migration, secret rotation, delivery activation or real send was performed. Keep release approval pending until the failing check and relevant operational/security decisions are resolved.

## S6 / S7 / S8 security verification — local only, 2026-11-02

All three checks pass against the current Node source with synthetic credentials and mocked external services. This is a scoped local result; Cloudflare rebuild/runtime verification remains pending. No generated Worker file, deployment, live database, credential, schema or delivery flag was changed. The existing S4 authentication/session sources remain byte-for-byte unchanged during this task.

S6: `contentModeration.service.ts` already rejected incorrect boolean/category field types. Focused tests exposed additional fail-open cases: object-shaped results, empty categories, contradictory flags, and ignored later malformed/flagged results. The shared response validator now requires a nonempty results array, validates every result and boolean category entry, rejects empty/contradictory category data, and aggregates all valid flags. Existing `reviewService.createReview()` and `updateReview()` retain PENDING plus a generic reason on failure; owner/manager `saveReviewReply()` returns the existing safe 503 before persistence. Safe/flagged classification, rating-only behavior, authorization and in-app notifications are preserved. No review-service business code was changed. Provider availability and classification accuracy are not certified by mocks.

S7: the application request logger already uses method, pathname and timestamp only. Two other runtime leaks were reproduced and fixed: branch appointments logged `req.originalUrl` before authentication, and availability logged the unfiltered query object (validation only replaces `req.body`). They now log pathname/a constant message respectively. The standalone manual moderation utility now uses the existing safe error logger instead of printing raw provider errors; it was not executed against OpenAI. Structured error logging records sanitized metadata and static route patterns; Worker `new URL(request.url).pathname` uses are legitimate routing/parsing, not log sinks. Existing business debug logs still include names, contact information, IDs and schedules in some paths; apply appropriate log access/retention controls. No direct credential/query log sink remains in the reviewed runtime paths. Do not put secrets in URL path segments.

S8: the existing application disables X-Powered-By and installs Helmet before CORS, webhooks and API routes. No `src/app.ts` rewrite was needed. Tests verify nosniff, SAMEORIGIN, no-referrer, one-year HSTS/includeSubDomains, same-origin COOP and absence of X-Powered-By across success/error/parser/webhook/preflight responses. Existing credentialed CORS and response envelopes are retained. A real locally computed Stripe signature is accepted with the original whitespace-preserving raw body; tampered/missing/invalid signatures are rejected without a ledger write. Mocked Microsoft code/state exchange, encrypted token persistence and one-use state continue through the real callback controller without secret logging.

CSP and CORP remain disabled for the current JSON API and separate R2 media architecture. The reviewed Express application does not serve browser-rendered HTML. Reassess CSP if HTML is added, and configure/test media policies on the media origin; CORS does not replace authorization. COOP popup/opener behavior still needs frontend/browser verification for any popup-based OAuth integration. HSTS is emitted by Helmet even in the local HTTP tests; this proves the header value, not TLS, HTTPS redirects or browser enforcement. Verify those separately on the real HTTPS API origin and ensure its subdomains support HTTPS before relying on includeSubDomains. No restrictive policy was added.

Changed files for this task:

- Production validation/logging: `src/app/module/contentModeration/contentModeration.service.ts`, `src/app/module/branch/branch.route.ts`, `src/app/module/availability/availability.service.ts`, `src/test-moderation.ts`.
- Tests: `cloudflare/moderation-security.test.mjs`, `cloudflare/http-security.test.mjs`, `cloudflare/test-support/node-security.mjs`.
- Wiring/documentation: `package.json` adds only `test:security`; `scripts/inventory-routes.mjs` permits only the exact branch log-sink replacement while retaining the immutable baseline and existing S4 checks; this README. Existing `test:auth` and aggregate regression command strings are unchanged.

Validation: **268 TAP tests passed, zero failed/skipped/cancelled**, plus TypeScript no-emit, Node compilation and all 148 historical route contract checks. The selected existing suites passed auth 40, errors 39, database 7, booking 52, notifications 18, group refund safety 23 and policy 37. The new suite passed moderation 43 and HTTP logging/headers/OAuth/webhook 9. Earlier runs reproduced nine moderation failures and three logging/source-guard failures; all were corrected. The route inventory initially rejected the changed log statement and then a changed line ending; the exact logging-only exception and original line ending now pass without changing the historical baseline. The final combined validation command exited 0. An online official-registry `npm audit --omit=dev --registry=https://registry.npmjs.org` exited 0 with zero known production vulnerabilities; this does not certify the absence of application-level issues.

Run the focused suite with `npm run test:security`. This task deliberately leaves the S4/shared full-regression command intact; run the focused suite alongside that command on the combined release snapshot. Local evidence is ignored under `node_modules/.cloudflare-test/s678-*`, including before/final test logs, final exit code, dependency audit and protected-file hashes.

Cloudflare gate: do not treat the previous S4 dry-run/manifest as verification of these new changes. Read-only source-map comparison found `src/app.ts` matching its embedded source, but moderation/branch/availability sources differ from the saved Worker. No rebuild or Worker execution was performed for this task. After S4 is integrated on a stable combined snapshot, regenerate through the normal build scripts, rerun Worker auth/API/provider regressions and security-specific header/logging/moderation probes, and verify fixture exclusion before a separately approved rollout. HTTPS, browser OAuth/media behavior, edge log controls and deployed headers remain external checks. No deployment is authorized by this report. The previously documented S4 persistent-revocation failure risk remains outside this task.

## S4 active-session enforcement — local candidate, 2026-11-02

Access JWTs now require `sid` and an exactly `"valid"` value at `auth:refresh:{userId}:{sid}` on every protected request. Login's access `sid` and refresh `jti` match. Refresh atomically consumes the old session and creates a new one with the remaining refresh JWT lifetime; the old access token is immediately unusable. Logout deletes its session; successful password-change/reset session invalidation deletes all sessions of that user, preserving other users. Existing user status, verification, roles and forced-password-change checks still apply.

The Worker adapter now matches the refresh Lua's exact-value check rather than accepting any nonempty value. `SET` validates EX before NX, `DEL` treats expired keys as absent, and nonpositive `EXPIRE` deletes immediately. SQLite transactions retain atomic rotation and compare-delete lock ownership. The supported user-wide SCAN operation is translated into one parameterized, exact-prefix SQL deletion. The adapter deliberately supports the application's known Lua scripts; it is not a general Lua interpreter. Node continues using the existing real Redis client/Lua.

Session read/write/rotation/deletion errors return a generic 503; they never authorize a request or disclose raw storage errors. Missing, expired, revoked or malformed session state returns 401. Invalid storage replies to session creation/rotation/user revocation also fail closed. Redis/DO session storage is now on the protected-request availability path; no session cache bypass was introduced.

Password reset attempts session revocation immediately after the committed password update and before reset-token consumption. Cleanup is still attempted if revocation fails. A cleanup error does not skip revocation; a completed password change is not rolled back. **There is no atomic transaction across PostgreSQL and Redis.** If revocation fails after the database update, the API returns 503 but old sessions may remain usable once the store recovers. A concurrent login that read the old password before that update can also create a session after the deletion. Hard guarantees across these failures/races require a durable per-user session version or equivalent credential epoch changed in the password transaction and enforced at session creation, refresh and every authenticated request. That schema/business change is not included in this scoped adapter fix. Do not describe current revocation as guaranteed under storage failure. Already authorized in-flight requests may complete.

If reset-token consumption itself fails, the token may remain usable until its existing TTL despite the password having changed; investigate before recovery/retry. Locks use compare-and-delete and must never remove another request's newer lock. No automatic recovery bypass, fabricated token or secret reset is added.

Rollout compatibility: legacy access tokens without `sid` receive 401; require login or use a still-valid refresh session to obtain the new token pair. Frontends must serialize refresh attempts and replace access and refresh tokens together; the refresh HTTP response retains its existing `{ accessToken, newRefreshToken }` contract. Parallel use of one refresh token has one winner, not two. Clear tokens after successful password change/reset and reauthenticate. No routes, roles, financial logic, email routing, database schemas, migrations, secrets or delivery flags are changed for S4.

S4 tests use synthetic credentials, mocked delivery, disposable SQLite, real Worker HTTP auth/services, concurrent adapter calls, storage-failure injection and restart persistence. Test-only `/__auth-session-test` is excluded from the production bundle and checked by `verify-unified-email-release.mjs`. Local checks: `npm run test:auth`, `npm run test:cloudflare:api`, `npm run test:regression`, `npm run cloudflare:prepare:staging` and `npm run cloudflare:check:staging`. These are local tests/packaging; do not deploy without separate approval. A live Redis-server outage/recovery or deployed Worker rollout is not certified by mocks.

S4 changes in this task (pre-existing auth/user security edits are retained):

- Production: `src/app/utils/auth-session.ts`, `src/app/module/auth/auth.service.ts`, `cloudflare/runtime/sessions.mjs`.
- New tests: `src/app/utils/auth-session.test.ts`, `src/app/module/auth/auth.session.test.ts`, `cloudflare/auth-session.integration.test.mjs`.
- Test fixture/wiring: `cloudflare/runtime/auth-session-fixture.mjs`, `cloudflare/runtime/integration-fixture.mjs`, `cloudflare/booking-regression.test.mjs`, `cloudflare/registration-email.integration.test.mjs`, `cloudflare/password-change.integration.test.mjs`.
- Test commands/release documentation: `package.json`, `scripts/verify-unified-email-release.mjs`, `cloudflare/README.md`. Existing password-limit tests are included in `test:auth`; no password policy is changed by that wiring.

Final S4 local validation (2026-11-02): `npm run test:regression` exited 0 with **371 TAP tests passed, zero failed/skipped/cancelled**. This includes 40 Node auth/security tests, 33 Worker API tests (11 focused S4 integration cases), 52 booking tests, and existing email, notification, financial and policy suites. `npm run typecheck`, Node compilation, v31 SQLite adapter/upgrade/atomic-rollback/repeated-initialization checks, 148 historical route contracts, `npm run cloudflare:prepare:staging` and `npm run cloudflare:check:staging` passed. All 91 checked historical migration files remain unchanged. Worker JS is 3,655,495 bytes; staging dry-run upload is 7591.92 KiB / gzip 2082.44 KiB including other upload artifacts. Production fixture exclusion passed. Source/configuration hashes remained unchanged throughout the final regression and packaging run; documentation is updated afterward. Logs and exit records are ignored under `node_modules/.cloudflare-test/s4-*`. No live deployment/migration, email, secret or delivery-flag change occurred. Staging's previously approved checked-in outbox flag remains true; production remains false. The persistent revocation and reset-token cleanup limitations above remain despite passing tests.

## Dependency security refresh — local candidate, 2026-11-02

Use the committed lockfile with `npm ci`. Node requirements match Prisma: `^20.19.0 || ^22.12.0 || >=24.0.0`. Existing installed Node 20.19.6 is used for runtime regression checks; a disposable clean lockfile install is also checked with Node 22.19.0 and lifecycle scripts disabled. No global Node setting is changed.

Wrangler 4.86.0 and Miniflare 4.20260426.0 share one runtime/test version, with matching Workers Types 4.20260426.1 accepted by the existing Prisma D1 adapter. Scoped overrides pin Wrangler's esbuild to 0.28.2 and Miniflare's sharp/undici/ws to 0.35.5/7.30.1/8.22.1. These patches avoid incompatible Workers Types major-version peers; no force/legacy-peer install is used. Preserve the overrides until an independently tested upstream upgrade supersedes them.

The refreshed Workerd appends extended SQLite error codes. `runtime/sqlite-errors.mjs` accepts both known code-suffix formats while retaining the existing constraint-message allowlist and generic redaction. Duplicate constraints still map to P2002; SQL, parameters and unknown messages remain redacted. No unique constraint, transaction, business calculation or migration is changed.

The local release manifest now includes the package-lock hash, Node/tool versions and matching-Miniflare assertion, alongside the existing migration and bundle-isolation evidence. Verify advisories using an online official-registry check: `npm audit --registry=https://registry.npmjs.org` and `npm audit --omit=dev --registry=https://registry.npmjs.org`. A restricted/offline registry result does not certify a current online audit. Release checks remain `npm run test:regression`, `npm run cloudflare:prepare:staging` and `npm run cloudflare:check:staging`; all use local disposable databases/mocked providers or dry-run packaging.

No live deployment, migration, provider call, secret or delivery-flag change is part of this refresh. Production delivery remains false; the previously authorized staging flag remains true. Confirm current recovery/ledger state before a separately approved staging release, then use `npm run cloudflare:deploy:staging`.

Dependency-only verification completed on 2026-11-02: final online official npm audits report zero vulnerabilities for both the full and production-only trees. Clean lockfile installation (scripts disabled), PostgreSQL schema validation, TypeScript, v31 disposable SQLite upgrades/recovery, artifact isolation and staging/production deployment dry-runs passed. The dependency/auth snapshot tested before subsequent password edits passed all 335 TAP tests, zero failed/skipped, and the complete regression command exited 0. Both the Prisma adapter and HTTP error normalizer now recognize Workerd's extended SQLite codes; old/new code formats and redaction are covered.

The separately approved current auth changes were included in that 335-test snapshot. A duplicate strict auth middleware on logout was removed so its explicit password-change exception works; three real Worker tests cover restricted access, own-password change/re-login, logout/refresh revocation and concurrent password changes. The exact logout/password route exceptions remain checked against the immutable historical baseline.

**Combined-workspace release gate remains pending:** the owner confirmed auth/password edits are still in progress and requested a dependency-only readiness report. Later `password-security.ts` / authentication-validation edits are outside the frozen 335-test snapshot. Do not treat those earlier passes or the saved artifact as certification of the evolving current source tree. Finish those edits, then rerun the full regression, staging preparation and dry-run before deployment. This task preserves the ongoing edits and does not certify the separate password-hardening feature as complete.

Evidence is in ignored `node_modules/.cloudflare-test/dependency-refresh-{verified-regression,prepare,staging-dry-run,production-dry-run,release-full-audit,release-production-audit,ci}.*`. The manifest binds the tested package-lock hash and tool versions to the artifact. No new database migration or secret is required by the dependency update.

## Login rate limiting — local release candidate

`POST /api/v1/auth/login` reserves an attempt after body validation and before password verification. Independent fixed windows allow ten attempts per normalized account and thirty per trusted client IP over fifteen minutes. A successful login clears only its account counter; IP history remains. Blocked requests return 429 with Retry-After, missing trusted IP returns 400, and unavailable/invalid limiter storage returns a safe 503. These budgets include successful attempts in the IP window.

Node uses the existing Redis Lua transaction. Workers translate the same two-counter operation into one existing Durable Object SQLite storage transaction; no Redis TCP connection is used. Counter values and expiry persist across Worker restart. The Worker continues using the edge-managed client IP, ignoring client-supplied forwarded headers. No schema migration, new secret or environment variable is introduced by this change; existing v1-v31 migration history and delivery flags are retained.

Validate locally with `npm run test:auth`, `npm run test:regression`, `npm run cloudflare:prepare:staging` and `npm run cloudflare:check:staging`. Login-specific Worker tests are included in `npm run test:cloudflare:api`. Tests use disposable databases and mocked providers. The production artifact verifier requires the login limiter and Worker session/IP adapters in the bundle; test controls are excluded.

After separate release approval, deploy staging using `npm run cloudflare:deploy:staging`. Preserve its namespace, singleton, secrets and current email-delivery policy, and check existing pending migrations/backups before any release. Confirm a valid login succeeds and that a dedicated test account/IP receives 429 at its configured limit; normal production accounts should not be locked out as a smoke test. No live deployment or email is performed by the preparation commands.

Local verification on 2026-11-02: all 328 regression TAP tests passed with no failures/skips; the final historical route checker initially rejected the new login middleware and then passed after its exact expected contract was added without editing the baseline. Typecheck, staging preparation, v31 migration upgrade/recovery checks, artifact isolation and both staging/production upload dry-runs passed. No application code changed after these tests. Logs are under ignored `node_modules/.cloudflare-test/login-rate-limit-*.log`. Node Redis transport is mocked; Worker counters/concurrency/expiry/restart use real disposable SQLite. Live configuration and deployed behavior remain release-time checks.

## Purchase validity snapshot — v31 local candidate

`0031_group_purchase_valid_days_snapshot.sql` adds nullable `GroupPurchase.validDaysSnapshot` as INTEGER. Existing purchases stay NULL; no historical validity, financial data, customer verification state or email delivery history is backfilled or rewritten. The existing transactionSync migration runner makes the column change and ledger insertion atomic. Versions 1–30 remain immutable.

The generated Worker Prisma schema and database-adapter metadata include the field. Build, schema-parity and release checks include v31. The current group-purchase application changes capture package validity when creating a purchase; local Worker API tests cover Buy Later, Direct PAY_NOW, DEPOSIT, RESERVE_NOW, package edits after purchase and nullable validity. This preparation does not edit those application business rules.

Local migration tests exercise injected failure rollback to v30, old row/value preservation, nullable/no-default schema, retained snapshot values on repeat initialization and foreign-key checks. The protected historical v19 backup also restores/upgrades locally through v31 with 13,319 original cells preserved; it is rehearsal input, not a fresh live recovery point.

Before a separately approved staging rollout, verify the current namespace/singleton, immutable ledger and a fresh usable backup while keeping the frontend API online. Run `npm run cloudflare:prepare:staging`; after release approval use the existing `npm run cloudflare:deploy:staging` command. Worker initialization applies only pending SQLite migrations. Never run the PostgreSQL SQL against Workers or reset/recreate the database. A pre-v31 Worker is not an automatic rollback target after v31 because the migration checker rejects extra ledger versions; retain a v31-compatible recovery artifact.

No live deployment, remote migration, secret change or real email/charge/refund is part of this preparation. Existing checked-in delivery flags are retained: staging true under the earlier activation authorization, production false. A future staging deployment retains that automatic-email setting; review the current backlog and provider state as part of release checks. This task does not independently certify current remote settings.

Final local verification on 2026-10-30: `npm run test:regression` exited 0 with **304 TAP tests passed, zero failed/skipped**. The focused Book Now suite passed 27 tests, including four snapshot purchase flows and nullable validity. `npm run cloudflare:prepare:staging` passed typecheck, generated-client/schema parity, migration checks and artifact verification; the manifest records v31, 91 unchanged historical committed SQL files and a 3,616,110-byte Worker JavaScript bundle. Wrangler staging `deploy --dry-run` exited 0 without deployment. The local historical backup rehearsal passed through v31 with 13,319 cells preserved. Ignored evidence is `node_modules/.cloudflare-test/validity-{regression,book-now,migrations,backup,prepare,staging-dry-run}.log`, with explicit exit-code files for regression/preparation/dry-run. None of these checks certifies current live backlog, secrets or ledger state.

## Cancellation/refund policy minutes — v29 local candidate

Only the requested cancellation/rescheduling, refund-tier and preview fields change from hours to minutes. See the complete field map and current Postman examples in [the policy API guide](../docs/CANCELLATION_REFUND_POLICY_API.md). Existing durations are preserved: 12 hours becomes 720 minutes, 2 becomes 120 and 24 becomes 1440. New requests can set 30/90-minute thresholds. API paths, money calculations, permissions, notifications and unrelated time settings remain unchanged. Frontend clients must update both the field names and units together; old hour request fields are not minute aliases. Preview elapsed-minute values may be fractional.

SQLite `0029_policy_time_minutes.sql` and PostgreSQL `20261030060000_policy_time_minutes` convert live policy columns/defaults and editable JSON tiers once. Invalid/conflicting JSON units and overflow fail closed. Existing checkout/refund/audit snapshots are not rewritten; detached normalization preserves their original thresholds and boundary modes during evaluation. Versions, timestamps and historical financial records are retained. Repeated migration initialization does not multiply values again. Old migration files remain unchanged.

This is a local candidate, with no live migration or deployment. Use the existing `npm run cloudflare:prepare:staging` checks before a separately approved rollout, verify a fresh usable backup/live ledger and coordinate the frontend contract change. Worker initialization applies pending SQLite migrations; never run PostgreSQL SQL against Workers. After v29, recovery requires a v29-compatible binary; a pre-v29 application is not an automatic rollback. Staging/production email flags and credentials were not changed by this conversion.

Local verification on 2026-10-30: `npm run test:regression` exited 0 with **280 TAP tests passed, zero failed/skipped**. Tests include 30/90-minute cutoff boundaries, actual 30-minute rescheduling and preview APIs, legacy snapshot financial equivalence, group refund age in minutes, invalid/conflicting units, migration overflow/rollback and repeated startup without double conversion. Node compilation, schema parity, financial/booking/email regressions and historical route checks passed. PostgreSQL Prisma schema validation passed; no live PostgreSQL upgrade was run. The protected historical backup restored/upgraded locally to v29 with 13,319 original cells checked, allowing only the explicit value/name conversions; it is not a current live backup. Ignored logs are `node_modules/.cloudflare-test/policy-minutes-{regression,prepare,backup}.log`.

Latest standalone TypeScript and Cloudflare build/artifact checks passed; the manifest records v29 and 91 unchanged historical SQL files. A concurrent payment-history feature edit temporarily interrupted the aggregate preparation command and was subsequently updated outside this time-unit task. The 280-test regression result above predates those independent payment-feature edits and does not certify that separate feature; rerun aggregate preparation/regression for the combined workspace before release. This task preserves those shared edits and does not change payment-history/refund-eligibility business rules. Latest logs: `policy-minutes-latest-typecheck.log` and `policy-minutes-build.log` in the ignored test directory.

## Registration email verification — v28 local candidate

The registration/verification changes are included in the Cloudflare bundle. SQLite `0028_registration_email_verification.sql` adds User.emailVerified (default false) and nullable emailVerifiedAt. As explicitly requested, customers present during the one-time migration retain access via emailVerified=true; no historical OTP verification timestamp is invented. New registrations remain unverified and repeat initialization never verifies them. Existing customer/account, booking, payment, notification and email history records are retained. v1-v27 SQL is unchanged.

The supplied PostgreSQL schema migration `20261030014939_add_email_verification` is retained unchanged. The unapplied `20261030020000_preserve_existing_customer_access` migration uses its read-only verified historical start time, `2026-10-30 01:49:40.572383 UTC`, as a fixed cutoff so shadow replay does not depend on an internal migration ledger. It preserves access only for older customers and leaves new registrations unverified. Verify this deployment-specific cutoff before using the migration on any other PostgreSQL database. Do not run PostgreSQL migrations against Workers. PostgreSQL schema validation is not a live PostgreSQL upgrade rehearsal.

Public requests (JSON, no owner token required):

```http
POST /api/v1/auth/register
{"name":"Test Customer","email":"your-approved-test-address@example.com","password":"StrongPassword123!"}

POST /api/v1/auth/verify-email
{"email":"your-approved-test-address@example.com","otp":"123456"}

POST /api/v1/auth/resend-verification-otp
{"email":"your-approved-test-address@example.com"}
```

Registration returns 201 and emailVerified=false, without an authenticated session or an inbox-delivery claim. Customer login/refresh/protected APIs require verification; staff/owner roles keep their existing exemption. Correct OTP returns 200, sets verification time and consumes the OTP; replay returns 409. Wrong/expired OTP returns 400, fifth wrong attempt returns 429. OTPs expire after five minutes and are stored as keyed HMACs. Resend uses the existing merchant-only security sender, five requests/15 minutes and a 60-second cooldown. Registration limits are five requests/IP/15 minutes and three/normalized email/hour. Worker limits use the edge-managed CF-Connecting-IP captured before the Node HTTP adapter; no broad Express proxy trust or client X-Forwarded-For fallback was added. Node retains req.ip.

Cloudflare's SQLite session adapter now implements the new atomic counter/cooldown, OTP store/verify/consume, reset-token issuance and owner-lock-release operations. The new verify-email EJS template is compiled into the Worker with escape/parity checks; runtime filesystem access is unnecessary. AUTH_EMAIL_VERIFICATION_OTP is supported by owner history filters and stale-SENDING quarantine, with no automatic uncertain replay. OTP bodies/codes are excluded from stored security email history. Provider/booking/payment/outbox selection logic is retained.

Registration sends immediately through an enabled, verified, runtime-ready merchant provider, independently of EMAIL_OUTBOX_ENABLED. A provider failure leaves the account unverified and recoverable through resend; accepted SMTP is not inbox confirmation. No new secret is required: retain the existing persistent encryption key, JWT secrets (at least 32 characters), merchant credentials and database namespace/singleton. The new password-reset implementation uses HMAC OTPs as well, so an outstanding older plaintext reset OTP may require a new request after rollout. Existing reset-token TTL/one-use behavior is retained.

Run `npm run cloudflare:prepare:staging` and `npm run test:regression` locally. Before any separately approved staging deployment, verify a fresh usable backup and the immutable live ledger, keep the frontend API online, and review merchant readiness: real registration requests can send security emails after deployment. This preparation performs no deployment, live migration, secret change or real send; staging's previously authorized true outbox flag and production's false flag remain unchanged. Worker initialization applies only pending versioned SQLite migrations. After v28, retain a v28-compatible recovery artifact; do not roll back to an older migration checker, reset the database or edit its ledger.

Verification on 2026-10-30: the complete `npm run test:regression` exited 0 with **276 TAP tests passed, zero failed/skipped**, including four new registration Worker tests with real SQLite and mocked Gmail sockets. Coverage includes the full verification/login lifecycle, access blocking, HMAC/TTL/attempts, rate/cooldown limits, replay/concurrent verification, failed/uncertain sends, stale security-send quarantine and no platform fallback. Existing booking/customer fixtures now explicitly represent verified accounts; the production access gate is exercised separately rather than bypassed. The standalone adapter fixture uses the current immutable migration runner instead of its stale v22 SQL list. Node compilation, TypeScript, PostgreSQL Prisma validation, fresh SQLite schema parity, v28 rollback/upgrade/repeat tests and historical route checks passed. The supplied register middleware addition is checked explicitly without rewriting the old route baseline. A protected historical v19 backup upgraded locally through v28 with all 13,319 original cells preserved; it is not a current live recovery point. Ignored evidence logs: `node_modules/.cloudflare-test/registration-{regression,prepare,backup,typecheck}.log`.

Final `npm run cloudflare:prepare:staging` exited 0. The release manifest records v28, 91 unchanged historical migration files, registration/template/runtime inclusion, bundle isolation and Worker JavaScript 3,564,284 bytes. No Wrangler deployment command was executed.

## Branch banner carousel — v27 local candidate

The user-added carousel schema/APIs are included in the Worker build. Additive SQLite `0027_branch_banner_carousel.sql` creates the final branch-scoped model: unique required branchId, optional brandId, default imageIntervalMs=5000 and videoIntervalMs=15000. Existing banners, media, branch assignments and email/financial records are unchanged. Previous migration files remain immutable. The supplied PostgreSQL migrations `20261029100537_add_banner_carousel_settings` and `20261029101521_add_branch_carousel_settings` remain unchanged; do not run them against Workers. For a separate PostgreSQL rollout, inspect any intermediate rows with NULL branchId before applying the supplied required-branch migration; do not guess a branch or discard rows.

New admin APIs (Authorization: owner or assigned branch manager):

```http
GET /api/v1/banners/carousel-settings/:branchId
PATCH /api/v1/banners/carousel-settings/:branchId
Content-Type: application/json

{"imageIntervalMs":7000,"videoIntervalMs":20000}
```

PATCH accepts either/both integer fields, 1000–120000 ms; empty, unknown, null and invalid values are rejected. GET returns fallback defaults before the first write. Settings persist per branch; an omitted field retains its existing value. Existing public active-banner response remains unchanged. No new public carousel-settings endpoint was added by this preparation task.

Preparation: `npm run cloudflare:prepare:staging` (local generation/build/schema/upgrade/artifact checks; no deployment). The regression suite includes real Worker API authorization, persistence, partial/concurrent updates and validation tests plus populated migration rollback, uniqueness, foreign-key/cascade and repeat-initialization tests. No live deployment, migration or email is authorized by build preparation. Keep the existing namespace/singleton and verify a current usable backup before any separately approved rollout; Worker initialization then applies only pending versioned SQLite migrations. A pre-v27 binary is not an automatic rollback after v27 because its ledger checker rejects extra versions.

Local verification on 2026-10-29: `npm run test:regression` exited 0 with 272 TAP tests passed, zero failed/skipped; Node compilation, migration/schema checks and 148 historical route assertions passed. PostgreSQL Prisma schema validation passed without running PostgreSQL migrations. The protected historical v19 backup restored and upgraded locally through v27, preserving 13,319 original cells and passing repeated initialization; this rehearsal is not a fresh live backup. Logs are ignored under `node_modules/.cloudflare-test/banner-carousel-{regression,prepare,backup}.log`.

Final `npm run cloudflare:prepare:staging` exited 0: TypeScript, generation, schema parity, v27 upgrade/rollback checks and production-bundle isolation passed. The manifest records 91 unchanged historical migration files, Worker JavaScript 3,546,778 bytes, staging business delivery true and production false. No Wrangler deployment or live database operation was run.

The previously approved staging outbox flag remains true and production remains false. This task changes neither live flags nor merchant settings. A future deployment includes the shared workspace's earlier email candidates as well as carousel changes; review pending v25/v26 migrations and enabled merchant delivery/backlog before approving that release. Never deploy maintenance or reset/seed the database to prepare this feature.

**Current v26 local candidate:** [unified merchant-only email](../docs/unified-merchant-email-system.md) adds enabled/unverified defaults for new configurations while preserving existing owner choices. All authentication and business mail uses the single merchant without platform fallback; sending still requires enabled, verified and provider/runtime readiness. Old skipped/uncertain records never replay. Staging's outbox flag was separately approved true; production remains false. This v26 defaults update is local only and is not deployment or real-send approval. See the dated activation/default sections in the linked guide; older false-flag/retirement instructions below are historical.

For the permanent v23 Email Outbox upgrade, follow the staging-only, delivery-disabled procedure in [transactional-email-system.md](../docs/transactional-email-system.md#permanent-outbox-management-upgrade-v23-local-candidate). This implementation does not authorize deployment, secret rotation, production rollout or real email delivery. Old generic deployment examples below are not activation approval.

For the current merchant/transactional email candidate, follow [transactional-email-system.md](../docs/transactional-email-system.md). Keep the frontend staging API online: implementation checks and migration rehearsals are local; do not deploy maintenance or run live migrations to prepare the build. `EMAIL_OUTBOX_ENABLED=false` keeps business delivery inactive. The v22 candidate includes an additive delivery-fence migration; after it is applied, a historical v19 application is not a compatible rollback. Current restored staging status is in [staging-api-restoration-report.md](../docs/staging-api-restoration-report.md). Live deployment and delivery activation each require separate authorization.

The existing Express routes and services have a separate Cloudflare build. The Node/PostgreSQL entry remains available. No Cloudflare account, production database, real payment or customer email was changed during implementation.

## Runtime

Remaining-payment APIs are included in the Worker Express build: `POST /api/v1/payments/appointments/:appointmentId/remaining-payment/stripe`, `POST /api/v1/payments/group-purchases/:purchaseId/remaining-payment/stripe`, `POST /api/v1/wallet/:appointmentId/remaining-payment/wallet`, and `POST /api/v1/wallet/group-purchases/:purchaseId/remaining-payment/wallet`. They require customer authentication. Wallet requests require `{ "useBonus": boolean }`; Stripe requests use the resource ID. Existing Stripe secrets and webhook endpoint handle the new intents. No additional binding or schema migration is needed. `npm run test:cloudflare:api` covers successful remaining payments, intent reuse, webhook replay, wallet debit amounts, role restrictions and duplicate-payment rejection.

The minute Cron Trigger in both production and staging runs appointment expiry, group-purchase expiry, automatic appointment completion, reminders and session cleanup through the same Durable Object queue. Workers invokes `completeEligibleAppointments()` directly; the Node `node-cron` file is used only by `src/server.ts`. Completion requires CONFIRMED status, full payment, QR verification and elapsed service duration. Transactions include the customer notification and system audit log; repeat runs do not complete an appointment twice. No additional Cron Trigger or schema migration is required for this job.

| Component | Cloudflare implementation |
| --- | --- |
| Express API | Worker with Node HTTP compatibility |
| Relational data | One SQLite-backed `SalonDatabase` Durable Object |
| Prisma transactions | Durable Object async storage transactions, including rollback |
| Redis sessions / OTP / counters | Indexed SQLite session table with expiry and atomic token consumption |
| Images | R2, using existing signed-upload API contracts |
| Password emails | TLS SMTP via Workers sockets (port 465); SMTP credentials required |
| Minute expiry jobs | Worker Cron Trigger through the same database queue |

D1 remains an isolated financial proof under `proof/`; it is **not the production database**. D1's Prisma adapter does not provide the interactive transaction guarantees required by the existing services. This implementation reuses its SQL/result conversion against Durable Object SQL, with real enclosing storage transactions, preserving current service callbacks within Cloudflare.

Money and percentages use integer hundredths with database precision checks and are converted back to the existing Decimal/API representation. Scalar lists use JSON. PostgreSQL row locks are replaced by the singleton request queue plus storage transactions. HTTP requests and expiry jobs share the queue.

The singleton has a 10 GB database limit and serializes requests; load-test expected salon traffic before production. Do not shard or change `salon-v1` without redesigning cross-table transactions. Stripe and OpenAI remain external API integrations already used by the application.

## Local setup and regression

Use Node 20.19+ or Node 22. The pinned Wrangler version supports the repository's Node 20 environment.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Fill .dev.vars with development/test credentials.
npm run cloudflare:build
npm run cloudflare:dev
```

Development data persists under `.wrangler`. Client generation and schema validation do not connect to PostgreSQL. Cloudflare builds replace the Node database, Redis, native bcrypt, SMTP and runtime EJS modules; the deployed entry never imports `src/server.ts`.

The pinned local runtime predates structured Email Service sending. Automated tests capture outgoing mail; verify actual delivery on staging. Negative constraint tests intentionally log the rejected SQL error while reporting a passing test.

Run the automated regression baseline:

```powershell
npm run test:regression
```

This generates both clients, compiles TypeScript and runs auth (8), database retry (4), booking/API fixtures (24), isolated D1 financial proof (12), actual SQLite adapter checks and real Worker HTTP integration. Tests use disposable databases and synthetic credentials. The Worker suite uses real Express middleware/controllers/services and SQLite persistence; outbound email is captured in a test outbox. Stripe signatures are generated locally; no API charges are made. Test fixture endpoints are excluded from the production bundle.

Verified Worker flows: registration/login, one-time setup, protected access, PAY_NOW/DEPOSIT/RESERVE_NOW, price/deposit snapshots, conflicting/concurrent bookings, wallet/ledger updates, duplicate payment rejection, money constraint rollback, cron expiry, refresh rotation/replay rejection, OTP cooldown, password reset/replay rejection, session invalidation, R2 URL signing and signed Stripe webhook replay. Adapter checks cover rollback, array transactions, exact money, row-lock translation, case-insensitive filters and session atomicity/expiry.

This does not certify every workflow. Run the full application regression on staging, including group purchases/vouchers, refunds/approvals, rescheduling/cancellation boundaries, staff capacity/leave, QR verification, salon collection, completion/no-show, admin/reporting/localization, Stripe intent completion/topups, real R2 upload/confirm/delete and real email delivery.

## Deploy staging first

1. Enable Workers Paid in the company's account. Authenticate with `npx wrangler login`, or provide scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your deployment environment.
2. Create a staging R2 bucket and bucket-scoped S3 credentials. Configure bucket CORS for the exact frontend origin, `GET`, `HEAD`, `PUT`, and required upload headers such as `Content-Type`. Signed URLs do not bypass bucket CORS.
3. Configure TLS SMTP: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_SENDER`. For Gmail, enable two-step verification and use a Google App Password; sender should match the authenticated account or an authorized alias. Workers use implicit TLS on port 465; port 25 and STARTTLS/587 are not supported by this application transport. Cloudflare Email Service domain onboarding and the EMAIL binding are no longer required. Upload these secrets to the staging environment and verify real password-reset delivery. Automated tests capture emails and do not certify live SMTP acceptance.
4. Prepare staging secrets with Stripe test keys, staging R2 storage, independent JWT/setup secrets and the actual frontend origin:

```powershell
Copy-Item cloudflare/secrets.example.json .cloudflare-secrets.staging.json
# Replace every example value; keep this ignored file private.
npx wrangler secret bulk .cloudflare-secrets.staging.json --env staging
npm run cloudflare:deploy:staging
```

If Wrangler asks to create the Worker during the first secret upload, create it. The `v1` migration provisions the SQLite Durable Object namespace. No D1 database, PostgreSQL URL or Redis server is needed. Schema initialization is transactional. Each pending versioned SQL migration runs once on object initialization. Version 2 adds the nullable WalletTopup.promotionId relation, preserving historical top-up snapshots and balances. Version 3 adds BranchBookingPolicy.qrVerificationRule with BEFORE_START_TIME as the default; existing policy values remain intact and BEFORE_END_TIME can be configured through the branch policy API.

5. Attach a staging API custom domain in Workers settings. Use the same parent domain as the frontend, such as `app.example.com` and `api-staging.example.com`, to preserve Secure/HttpOnly/SameSite=Lax cookies. Cross-site `pages.dev` to `workers.dev` cookie authentication needs a separate cookie policy review. Enable credentials in frontend requests; `CORS_ORIGIN` must match exactly.
6. Initialize the owner and brand once:

```powershell
$salonApiUrl = "https://api-staging.example.com"
$salonSetupToken = "YOUR_BOOTSTRAP_TOKEN"
Invoke-WebRequest -Method Post -Uri "$salonApiUrl/__setup" -Headers @{ Authorization = "Bearer $salonSetupToken" }
```

Setup requires a secret of at least 32 characters, accepts POST only and permanently closes after success for that database. Remove the `BOOTSTRAP_TOKEN` and `BRAND_OWNER_PASSWORD` deployment secrets after setup. Keep setup tokens out of frontend code.

7. Register a Stripe test webhook at `/api/v1/payments/stripe/webhook`, configure the payment-intent success/failure events used by the app and upload its signing secret. Exercise topups, appointment/deposit and group-purchase payment flows in Stripe test mode. Raw webhook parsing remains before JSON middleware; signature verification is asynchronous for Workers.
8. Run full frontend/API regression on staging. Check minute cron runs, expired holds, password-reset delivery, R2 CORS and upload confirmation. Review storage/CPU usage under expected concurrent traffic.

## Production cutover

### Brand email settings schema upgrade (v19)

`0019_brand_email_settings.sql` adds `BrandEmailSetting` with one setting per brand, cascading brand relations, nullable encrypted SMTP/OAuth credentials and disabled/unverified defaults. SQLite stores `EmailProvider` as text; generated Prisma enums contain all six providers. Existing brand/payment data and global SMTP settings are preserved. Deploying applies the schema once on Durable Object initialization.

The email-settings router is now mounted in `src/app.ts`. The provider implementation includes a Worker-specific SMTP socket adapter, Microsoft Graph OAuth, Resend DNS/domain verification and guarded custom SMTP on Node only. v20 adds the dormant outbox table; v21 adds provider configuration version/status metadata and invalidates old verification once while retaining encrypted credentials. No business-email scheduler or booking-email trigger is activated. See [the merchant email setup and Postman guide](../docs/merchant-email-provider-guide.md) for secrets, external setup, mock-test evidence and pending real-provider verification. Tests use synthetic credentials and do not send real emails.

### Historical payment order number backfill (v18)

`0018_backfill_payment_order_numbers.sql` is the Cloudflare equivalent of the Node/PostgreSQL `scripts/backfill-payment-order-numbers.ts` script. On first database initialization after deployment, it fills only NULL payment codes atomically with distinct six-character codes containing letters and digits, skipping existing codes. Existing codes, financial fields and relations remain unchanged. Future payments can still have NULL codes because the schema remains optional; this migration is a one-time backfill.

No separate backfill command is needed on Cloudflare. Run `npm run cloudflare:check`, `npm run test:cloudflare:migrations` and the database/API regressions, then deploy with `npm run cloudflare:deploy:staging` or `npm run cloudflare:deploy`. This does not execute the PostgreSQL backfill script.

### Payment order number upgrade (v17)

`0017_payment_order_number.sql` adds nullable, unique `Payment.orderNumber`. Historical payments keep null codes, amounts and relations; this migration does not generate payment order numbers. Existing appointment order numbers are unchanged. The build bundles v17 and it applies once on Durable Object initialization after deployment. A matching PostgreSQL migration is included for the Node runtime.

Validate using `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, `npm run test:cloudflare:database`, `npm run test:cloudflare:api` and `npm run test:book-now`. Then deploy with `npm run cloudflare:deploy:staging` or `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Required appointment order number upgrade (v16)

`0016_require_appointment_order_number.sql` backfills only NULL order numbers with distinct six-character codes, skipping codes already in use. It then rejects NULL inserts and updates using database triggers. This preserves the referenced Appointment table, payment/refund relationships, money triggers and existing indexes. SQLite's column metadata remains nullable; the schema checker verifies both trigger definitions before accepting their equivalent required-field enforcement. Prisma exposes the field as required.

Backfill and enforcement run atomically once on Durable Object initialization. No separate PostgreSQL backfill command is needed for Cloudflare. Existing non-null codes and other appointment fields remain unchanged. Do not run the Node/PostgreSQL backfill script against Cloudflare.

Verify with `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, `npm run test:cloudflare:database`, `npm run test:cloudflare:api` and `npm run test:book-now`. Then use `npm run cloudflare:deploy:staging` followed by `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Appointment order number schema upgrade (v15)

`0015_appointment_order_number.sql` adds nullable `Appointment.orderNumber` with a unique index. Historical appointments retain null order numbers; new bookings generate six-character codes. PostgreSQL `@db.VarChar(6)` becomes SQLite text during Cloudflare schema generation. Existing migrations remain unchanged and v15 applies once on Durable Object initialization after deployment.

Run `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations` and `npm run test:cloudflare:api` before deployment. Deploy staging with `npm run cloudflare:deploy:staging` and production with `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Staff portfolio schema upgrade (v14)

`0014_staff_portfolio.sql` adds `StaffPortfolioCase` and `StaffPortfolioCaseImage` with their indexes. Portfolio tags use JSON arrays and status uses text in SQLite. Deleting a service retains its portfolio cases with a null service reference; deleting staff removes its cases and images. Existing migrations remain unchanged, and pending v14 applies once on Durable Object initialization after deployment.

Validate with `npm run cloudflare:check`, `npm run typecheck`, `npm run test:cloudflare:migrations`, and `npm run test:cloudflare:database`. Then deploy staging with `npm run cloudflare:deploy:staging` and production with `npm run cloudflare:deploy`, retaining existing secrets and database identity.

### Banner schema upgrade (v13)

`0013_banner_management.sql` adds `Banner`, `BannerBranch` and `BannerMedia`, including indexes and cascading foreign keys. The Cloudflare build generates the Prisma client and bundles this migration; each existing Durable Object applies it once on initialization, preserving existing records. PostgreSQL migrations under `prisma/migrations` are not used by this runtime.

Before deploying this schema change, run:

```powershell
npm run typecheck
npm run cloudflare:check
npm run test:cloudflare:migrations
npm run test:cloudflare:api
```

Deploy staging with `npm run cloudflare:deploy:staging`, then production with `npm run cloudflare:deploy`. Existing secrets and the `salon-v1` database identity must be retained. Banner JPEG/MP4 uploads use the existing R2 credentials and bucket CORS configuration.

The default Worker is `hair-salon-backend`; staging has a separate Worker and Durable Object namespace. Prepare `.cloudflare-secrets.production.json` with production settings and separate R2 storage, then:

```powershell
npm run cloudflare:check
npx wrangler secret bulk .cloudflare-secrets.production.json
npm run cloudflare:deploy
```

Repeat domain, setup, webhook and delivery checks for production. If existing PostgreSQL data must be retained, **do not switch traffic yet**: these scripts do not import existing records or Redis sessions. Back up and rehearse a separately verified import preserving IDs, relations, timestamps, Decimal-to-hundredth conversion, arrays and financial totals. Sessions need migration or a deliberate fresh login. Keep the old backend available until cutover validation completes.

The initial SQLite migration is immutable after deployment. Build-time schema drift checks and runtime checksums reject incompatible versions. Versioned SQL is bundled by build-cloudflare.mjs and checked against the generated schema by applying all versions to disposable SQLite. Runtime checks every applied checksum before running pending versions. `npm run test:cloudflare:migrations` verifies a populated v1/v2-to-v3 upgrade, repeated initialization, foreign keys and checksum rejection. Future changes require registering new versioned SQL in the build/schema check and testing upgrades on populated data; do not overwrite `0001_initial.sql`, delete the Durable Object migration, rename its class or change its singleton name to bypass a mismatch. Configure database backups/recovery before accepting live financial traffic.

References: [Express on Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/), [Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Email sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
