# International phone support — Cloudflare staging candidate

2026-11-06. **Local staging release checks pass.** The normal production Worker bundles the installed `libphonenumber-js@1.13.15` package and successfully executes international phone normalization through the real authenticated profile APIs in disposable Miniflare. No deployment or live database/provider operation was performed.

## Production compatibility

The owner's existing registration/profile validation and service changes are preserved byte-for-byte. The existing Worker browser/ESM bundler includes the library and its minimum country metadata directly; no runtime adapter, special alias, new binding, secret or schema migration is needed. The dependency and lockfile entries were already supplied by the owner and were not changed by this preparation.

Phone validation covers all **245 country/territory entries** in the installed metadata. Both real request validators accept the package's synthetic example for every supported country and normalize formatted international numbers to E.164. Phone remains optional. Real Worker tests cover BD/HK/IN/CN/GB/US registration, email verification, login, profile reads and subsequent changes to AU/DE/FR/JP/AE/SG numbers. Canonically equivalent duplicates remain 409; invalid or unauthenticated changes preserve the previous value.

The production release verifier now requires the library metadata and auth/user call sites, confirms the installed version matches the lockfile, excludes synthetic example data and records the phone version in the release manifest. Existing fixture/S4/S6/S7/S8 exclusion and immutable migration checks remain intact.

## Verification

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS, also included in staging preparation. |
| `npm run test:auth` | **45/45 PASS**, including five new phone validation cases; the two country-wide cases each exercise all 245 metadata entries. |
| `npm run test:regression` | **459/459 PASS**, zero failed/skipped/cancelled, exit 0. |
| `npm run test:security` | **86/86 PASS**. |
| `node --test --test-concurrency=1 cloudflare/security.integration.test.mjs cloudflare/tencent-production.integration.test.mjs` | **10/10 PASS**: eight existing strict Worker security cases and two reported production boot/profile cases. |
| `npm run cloudflare:prepare:staging` | PASS: typecheck, generation, normal build, schema parity, disposable migration/upgrade checks and release isolation. |
| `npm run cloudflare:check:staging` | PASS, exit 0; upload dry-run only. |
| `node scripts/verify-unified-email-release.mjs` after the final dry-run | PASS; final normal artifact and manifest agree. |
| `node --test cloudflare/tencent-production.integration.test.mjs` after the final dry-run | **2/2 PASS** against that exact artifact: boot/setup with disposable v36 storage, source freshness, HTTP/security/CORS and authenticated international-phone update/read/invalid-input behavior; zero external calls. |
| `npm audit --omit=dev --registry=https://registry.npmjs.org` | PASS, **zero known production dependency vulnerabilities**. |
| Historical route checker / integrity / `git diff --check` | PASS: 148 historical routes plus 72 later routes inventoried; no collisions; starting production sources and unrelated changes retained. |

Every original aggregate regression stage remains in the same command and order. The existing `test:auth` command only gains the new phone-validator file. The new Worker cases are appended to an already included registration test file. The previous 445 aggregate cases grow by five Node cases and nine Worker parent/subtest cases to **459**; none are removed. Distinct composed coverage is **555 TAP cases** (459 + 86 + 8 + 2), excluding reruns and including TAP-reported parent/subtest counts. The 245 examples are assertions within tests, not 245 separate TAP cases per validator.

An initial focused Worker run passed 20/21: the strict source-map freshness case correctly rejected the old saved production bundle after the owner's source edits. Rebuilding normally resolved it; the same strict check then passed without modification. A local report-counting helper initially decoded PowerShell UTF-16 logs as UTF-8; correcting that helper reproduced the recorded counts above. No failed application assertion was skipped or weakened.

## Final artifact and integrity

- Normal Worker: **3,757,509 bytes**, SHA-256 `3117ffe930566eaaf47ba659156ab10079d5c87f51a8b57e9d56ddee9ffbbb86`.
- Staging upload dry-run: **7684.11 KiB / gzip 2107.84 KiB**, including upload artifacts.
- Migration version remains **36**; **92 historical migration files** unchanged. No new migration accompanies this feature.
- Staging delivery remains **true**; production delivery remains **false**. Namespace/class/singleton and runtime configuration are unchanged.
- **535 starting nonignored files** were hashed; **536 files** including the new test were frozen throughout final regression/build verification. Only the four existing test/wiring/verifier files listed below changed relative to task start. The owner's auth/user phone implementation, service/staff assignment work and dependency lockfile remain unchanged.

Task changes relative to the starting workspace:

| File | Purpose |
| --- | --- |
| `cloudflare/phone-validation.test.mjs` (new) | Country-wide request-schema coverage, E.164 normalization, invalid input and optional-field behavior. |
| `cloudflare/registration-email.integration.test.mjs` | Nine additional reported Worker cases for registration/profile persistence, duplicate protection and authorization. |
| `cloudflare/tencent-production.integration.test.mjs` | Real phone-parser execution through authenticated APIs in the exact normal production artifact. |
| `package.json` | Append the phone validator tests to the existing auth command; no task-introduced dependency/version changes. |
| `scripts/verify-unified-email-release.mjs` | Phone package/lockfile/bundle checks, synthetic-data exclusion and manifest evidence. |
| `docs/international-phone-cloudflare-release.md` (new) | This report. |

Evidence/exit records are ignored under `node_modules/.cloudflare-test/phone-release/`. Generated artifacts were regenerated through normal scripts, never manually edited. No production business code, schema, migration, S4 session implementation, S8 implementation, secret, delivery setting or live record was changed by this task.

## Rollout scope and limits

The frontend must send `+country calling code` on new phone input. The library checks numbering-plan validity; it does not prove number ownership, reachability or SMS delivery. Existing stored phone strings are not automatically rewritten. Historically formatted/local equivalents may not match canonical strings in exact database uniqueness checks; this preparation does not certify or backfill legacy phone data. Any historical normalization needs a separate collision-aware review.

The default minimum metadata remains the owner's chosen validation policy; it is not a claim that every country has equally exhaustive allocation-pattern validation. Other existing staff/branch/contact phone APIs were not converted to a new global policy by this task. The owner's separate service/staff changes are included in this combined artifact and preserved, but their new feature requirements were not independently re-audited here.

Local tests do not certify current live credentials, frontend UX, remote recovery state or production load. For a separately authorized staging deployment, use the normal fresh-build command:

```powershell
npm run cloudflare:deploy:staging
```

Retain the existing database namespace/singleton, secrets and delivery settings. No deployment has been executed by this preparation, and no historical application rollback is part of this candidate.
