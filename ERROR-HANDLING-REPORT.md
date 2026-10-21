# Backend error handling changes

Expected operational errors now retain their HTTP status and domain message in Node and Cloudflare production responses. Unexpected errors return a safe 500 response. The changes are implemented and locally verified; deployed staging has not been redeployed or verified as part of this task.

## Root causes

1. `globalErrorHandler` replaced every production error name and message with `Internal Server Error`, even when it correctly selected a 401, 403, 409 or 422 status.
2. `AppError.name` was `AppError`, rather than an HTTP status title. The response name now comes from the status without changing the error class or existing domain messages.
3. `validateRequest` retained only the first Zod message and discarded issue paths and other validation failures. Direct Zod errors were not normalized.
4. Database handling covered only a few Prisma/PostgreSQL cases. SQLite errors can be nested in `meta.driverAdapterError.cause`; a real money-precision failure surfaced as Prisma P2039 and previously became a generic 500.
5. Worker and Durable Object failures outside Express had no shared JSON boundary. Internal/setup failures used plain text. The Express route-not-found response also used a different structure, and its middleware followed the error handler.
6. JWT expiry messages were technical, signed tokens with missing user IDs reached Prisma, and user controller authentication guards threw plain errors.
7. Existing error logs printed complete exception objects, potentially including SQL/provider details. Node had no application-level safe fatal-error logging.
8. Image verification converted every storage error into `UPLOADED_IMAGE_NOT_FOUND`, including backend credential/network failures.

## Changed files and functions

| File | Functions and change |
| --- | --- |
| `src/app/utils/normalize-error.ts` | New `normalizeError`, `errorBody`, `validationDetails`, `logUnexpectedError` and bounded driver-cause/constraint helpers. Shared, environment-independent normalization and sanitized logging. |
| `src/app/middleware/globalErrorHandler.ts` | `globalErrorHandler` sends normalized JSON, safely logs unexpected failures and delegates errors after headers have been sent. |
| `src/app/middleware/validateRequest.ts` | `validateRequest` keeps all safe Zod issue paths/messages in `AppError.details`; the first message remains the top-level message. |
| `src/app/middleware/notFound.ts` | `notFound` forwards a 404 `AppError` into the central handler. |
| `src/app.ts` | Registers not-found middleware before the error handler. No routes or success payloads changed. |
| `src/app/middleware/auth.ts` | `auth` rejects tokens without a nonempty string user ID as 401 before querying the database. |
| `src/app/utils/jwt.ts` | `verifyToken` distinguishes expired sessions from invalid tokens using safe public messages. |
| `src/app/module/user/user.controller.ts` | `getMe`, `updateMe`, `changePassword` use the existing 401 `AppError` for missing identity. |
| `src/app/utils/process-errors.ts` | New `installFatalErrorHandlers`; unhandled rejections/uncaught exceptions are safely logged, then Node exits with code 1. |
| `src/server.ts` | Installs fatal handlers and sanitizes startup error logging. |
| `cloudflare/runtime/errors.mjs` | New `failureResponse`, using the same normalizer as Express. |
| `cloudflare/worker.mjs` | `SalonDatabase.fetch` and Worker `fetch` catch errors before crossing the DO boundary; setup/private-route errors share the JSON contract. `scheduled` tracks and safely logs failed expiry work. |
| `cloudflare/runtime/database.mjs` | `sqliteBinding` retains recognized constraint information while removing raw driver causes/unknown SQL text before upstream adapter logging; `minor` uses a 400 `AppError` for invalid monetary precision/range. Transaction logic is unchanged. |
| `src/app/module/upload/upload.service.ts` | `verifyImageExists` preserves existing validation errors and real object-not-found 404s; backend storage failures return a safe 502 and are logged. |
| `src/app/utils/normalize-error.test.ts` | Normalization, real Express HTTP boundary, redaction, Prisma/SQLite/PG errors, JWT errors and Node fatal-process tests. |
| `cloudflare/upload-errors.test.mjs` | Real upload service tests for missing objects, outages, backend permission failures, invalid type and invalid/oversized files. |
| `cloudflare/runtime/integration-fixture.mjs` | Test-only injection of real database constraint failures and Worker/DO infrastructure failures. Excluded from the production entry. |
| `cloudflare/runtime.integration.test.mjs` | Runs in production mode and verifies meaningful errors, safe unexpected errors and existing successful auth/booking/wallet flows. |
| `package.json` | Adds `test:errors` and includes it in `test:regression`. |

Logging-only changes replace raw exception logging in these existing callbacks/catch blocks; their retry, rollback, notification and moderation behavior is unchanged:

- `src/app/lib/prisma.ts` — connection error callback.
- `src/app/lib/redis.ts` — Redis error callback.
- `src/app/lib/nodemailer.ts` — SMTP verification failure.
- `src/app/jobs/appointment-expiry.job.ts` and `src/app/jobs/group-purchase-expiry.job.ts` — expiry failure callbacks.
- `src/app/module/appointment/appointment.service.ts` — diagnostic transaction and three booking retry logs.
- `src/app/module/auth/auth.service.ts` — nonfatal password-reset notification failure.
- `src/app/module/payment/payment.service.ts` — intent/refund error logs.
- `src/app/module/refund-request/refund-request.processing.ts` — Stripe refund error log.
- `src/app/module/review/review.service.ts` — moderation, notification and image-cleanup error logs.
- `src/app/module/staff/staff.service.ts` — account/status/branch-assignment/schedule notification error logs.

`AppError` itself, booking/wallet/deposit/refund decisions and successful API payloads are unchanged. Existing module-specific `AppError` codes and messages remain authoritative.

## Supported categories

| Category | Public behavior |
| --- | --- |
| Zod validation, missing/invalid fields and UUIDs | 400; existing custom message and safe structured issue paths/messages |
| Invalid JSON or URL encoding | 400; safe parsing message without the submitted body |
| Oversized body or too many parameters | 413 |
| Unsupported request encoding/charset | 415 |
| Missing/invalid/expired authentication | 401; meaningful message and `Unauthorized` |
| Permission failures | Existing 403 message and `Forbidden` |
| Missing routes/records | 404; existing domain message, or a safe missing-record fallback |
| Duplicate records | 409; email/phone-specific fallback where trusted constraint metadata identifies the field |
| Foreign keys, required DB fields, check constraints, range/precision | 400; safe constraint message without SQL/schema details |
| Concurrent database updates | 409; retry guidance |
| Database availability/pool/transaction timeout | 503; safe temporary-unavailability message; never database credentials presented as a user 401 |
| Booking methods, conflicts, capacity, payment/refund eligibility, uploads, rate limits | Existing `AppError` status/message, including 400/403/404/409/422/429/502/503 |
| Missing uploaded object versus backend storage outage | Existing 404 versus safe 502 |
| Unexpected errors or provider errors without an explicit safe translation | 500 `Internal Server Error` |

Prisma P2025 now returns 404 rather than the old 400 missing-record fallback. Database authentication/connectivity failures return a safe 503 rather than implying that the API caller's login failed. Arbitrary provider `statusCode` properties are not trusted as public API errors.

## Before and after

Before, a missing authentication token in production returned:

```json
{"success":false,"statusCode":401,"name":"Internal Server Error","message":"Internal Server Error"}
```

After:

```json
{"success":false,"statusCode":401,"name":"Unauthorized","message":"You are not logged in. Please log in to access this resource."}
```

A validation response now retains safe detail:

```json
{"success":false,"statusCode":400,"name":"Bad Request","message":"Invalid email address","details":[{"path":["body","email"],"message":"Invalid email address"}]}
```

An unexpected exception remains:

```json
{"success":false,"statusCode":500,"name":"Internal Server Error","message":"Internal Server Error"}
```

No raw exception, SQL, stack, connection URL, request headers/body or provider payload is serialized. Application logs contain an incident ID, static source/route, error name/code and function names rather than raw messages/stack locations. The upstream SQLite converter may still emit recognized constraint diagnostics in private runtime logs; unknown SQL text and original raw causes are removed before it receives storage exceptions.

## Verification

- TypeScript `typecheck` and Node `build`: passed.
- Error-focused tests: 38 passed, including six real upload service cases and child-process checks for both Node fatal paths.
- Existing auth: 8 passed; database retry: 4 passed; booking/API fixture tests: 24 passed; isolated D1 financial proof: 12 passed.
- SQLite adapter checks: passed, including rollback, exact money, array transactions, row-lock translation and session atomicity/expiry.
- Real Worker HTTP suite: passed in `NODE_ENV=production`, including expired/invalid/missing JWT, permissions, Zod details, route errors, actual unique/FK/not-null/money constraints, Worker/DO failures and successful booking/payment/session flows.
- Production Worker build and deployment dry-run: passed. No live deployment was performed.

Re-run with `npm run test:regression`; use `npm run cloudflare:check` to rebuild and dry-run deployment.

## Remaining limitations

Staging still needs redeployment and verification on its real URL. No live PostgreSQL server, payment provider, R2 account or email service was exercised for this task. PostgreSQL error mappings use actual Prisma error classes and representative driver errors; R2 failure classification uses the real service with a mocked S3 transport.

The shared handler applies to every module, but these tests do not execute every endpoint/business permutation. Errors before Worker module initialization, such as invalid deployment bindings or import-time configuration, remain deployment/startup failures. A response whose headers/body have already been sent cannot be replaced with a new JSON envelope. Nonfatal notification/moderation/cleanup failures retain their existing business behavior.
