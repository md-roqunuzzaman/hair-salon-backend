# QR-policy auto no-show release check

Verified locally on 2026-11-17. The updated `autoMarkNoShowAppointments` is ready for a controlled staging deployment. No deployment, live data, secret, schema or migration change was performed by this preparation task.

## Behavior

- `BEFORE_START_TIME`: eligible at appointment start plus 15 minutes.
- `BEFORE_END_TIME`: eligible at appointment end plus 15 minutes.
- Missing branch policy: defaults to `BEFORE_START_TIME`, matching Prisma.
- The transaction re-reads the current branch policy, attendance, appointment status and deadline before changing status. Existing eligible reservations may consequently be marked earlier than under the previous end-only rule. This is the owner's service change, retained as supplied.

## Test fixes

`cloudflare/no-show-regression.test.mjs` now supplies `branchId` and mocks the branch policy both outside and inside the transaction. The original four tests explicitly use `BEFORE_END_TIME`, preserving their deadline, attendance, rescheduling and 102-row batching assertions. Six new cases verify both policies immediately before/at their deadline, policy changes before the transaction, missing-policy fallback, audit metadata and reason text. Unexpected logged per-row errors now fail the fixture, preventing negative eligibility tests from passing merely because a missing mock threw.

`cloudflare/no-show.integration.test.mjs` and its disposable `runtime/no-show-fixture.mjs` additionally exercise persisted start/end policies through the real scheduled Worker handler, including staff-free appointments, grace-period exclusions, audit records, notifications, repeat execution and unchanged finances. The existing injected-failure rollback/recovery test remains intact; its intentional SQLite error log is expected and the test passes.

The production service was not edited by this task. `package.json` adds `npm run test:no-show` for the unit and Worker suites.

## Final checks

| Check | Result |
| --- | --- |
| Booking/staff/no-show regression | 72 passed, 0 failed/skipped/cancelled; includes all 10 no-show unit tests |
| Real Worker no-show integration | 2 passed, 0 failed/skipped/cancelled |
| Exact production artifact boot/source isolation | 2 passed, 0 failed/skipped/cancelled |
| Distinct TAP entries above | 76 passed; repeated unit executions excluded |
| `npm run cloudflare:prepare:staging` | Passed: TypeScript, Prisma generation, schema parity, migration preservation/rollback and release verifier |
| Staging upload dry-run | Passed: 7845.06 KiB / gzip 2140.92 KiB |

The normal production Worker is 3,899,341 bytes. The release verifier confirms v41, 94 unchanged historical migration files and fixture isolation. No additional migration is needed for the existing QR policy enum/field. The broader API/security aggregate was not rerun for this scoped test-fixture update.

## Reproduce

```powershell
npm run test:no-show
node scripts/verify-issue152.mjs booking no-show-policy
npm run cloudflare:prepare:staging
node --test cloudflare/tencent-production.integration.test.mjs
npm run cloudflare:check:staging
```

All checks are local; staging dry-run does not publish. Normal deployment uses `npm run cloudflare:deploy:staging`. Preserve existing database identity and settings, and verify deployed cron/audit behavior afterward. The previous read-only live cron observation predates this updated release; it does not prove this new policy-aware build has been deployed.
