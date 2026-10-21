# Historical Cloudflare migration compatibility audit

Date: 2026-10-16

This records the audit before implementation. A Cloudflare Worker entry, transactional SQLite Durable Object database, session adapter and real Worker API integration tests have since been added. Current setup instructions and remaining staging checks are in [cloudflare/README.md](cloudflare/README.md).

The API and application storage must run within the company's Cloudflare account while preserving existing API contracts and business rules. This requires a database and authentication storage migration, not just a deployment configuration. Production migration is not ready. Application source and the current PostgreSQL migrations remain unchanged by this audit.

## Baseline verification

| Check | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm run test:auth` | 8 tests passed |
| `npm run test:database` | 4 tests passed |

The test commands initially encountered sandbox `spawn EPERM`; both passed when rerun with execution approval. The database suite tests retry behavior with simulated errors; it does not connect to a database. These results establish compilation and existing unit coverage, not booking, payment, database connectivity, or Workers compatibility.

## Proposed Cloudflare services

A first isolated persistence experiment is available in `cloudflare/proof`. Its 12 local Miniflare D1 tests and six SQLite checks pass. The earlier workerd download problem is resolved. Another 24 tests verify current booking/availability rules and Express HTTP contracts using database fixtures. The production API still uses PostgreSQL; full D1 booking integration and remote staging validation remain pending. See `cloudflare/README.md` for coverage and limitations.

| Responsibility | Proposed service | Compatibility work |
| --- | --- | --- |
| Express HTTP API | Workers with Node compatibility and HTTP server adapter | Separate entry point, binding access, request context, bundle verification |
| Relational data | D1 | SQLite schema, new migrations, query and transaction redesign |
| Sessions and OTP | SQLite backed Durable Objects | Explicit atomic operations, expiry checks, cleanup, invalidation |
| Images | Existing R2 bucket | Preserve signed upload and download API contracts |
| Expiry tasks | Cron Triggers | Scheduled handler, retries, idempotency |
| Transactional email | Cloudflare Email Service | Account eligibility, sending domain setup, template bundling and delivery tests |

Stripe and OpenAI remain external application integrations. A Cloudflare hosting requirement does not move their processing into Cloudflare. Whether these integrations are allowed must be resolved before replacing or removing their behavior.

## Required changes and evidence

### Database correctness

- `src/app/module/appointment/appointment.service.ts` uses interactive transactions and serializable isolation for booking flows. Preserve capacity checks, payment state transitions, staff allocation, and conflict behavior under simultaneous requests.
- `src/app/module/wallet/wallet.service.ts` uses serializable transactions for spending and balance changes. Preserve paid versus bonus balance allocation and ledger consistency.
- `src/app/module/payment/payment.service.ts` and `src/app/module/refund-request/refund-request.processing.ts` use transactions and PostgreSQL `FOR UPDATE` row locks. Preserve webhook deduplication, refund limits, and exactly one financial effect across retries.
- `src/app/module/brand/brand.service.ts` also uses `FOR UPDATE`; transaction changes affect administrative features as well as payments.
- Branch, capacity, package, service, staff, group purchase, promotion, review and manager modules also contain transactions. Inventory every active call before changing the database adapter.
- D1 atomic batches roll back when a statement fails, but are not a direct replacement for an interactive JavaScript transaction. A conditional update affecting zero rows does not itself fail a batch. Design failure conditions and assertions explicitly.
- Durable Object storage transactions apply to that object's own storage, not D1. Using an object as a coordinator does not make multiple D1 calls atomic; every related writer and scheduled handler must follow the same coordination design, and crash recovery must remain correct.

### Schema and API representation

- `prisma/schema` contains monetary `Decimal @db.Decimal(...)` fields. For D1, evaluate integer minor units with explicit currency scale, bounds, rounding and overflow handling. Keep existing external amount representations stable through serialization adapters.
- Package and service schemas contain scalar `String[]` fields. Replace these with ordered child rows or JSON while preserving API arrays, ordering and defaults.
- Several modules use `mode: "insensitive"` filters. Specify search and uniqueness behavior explicitly, including multilingual text, instead of assuming SQLite collation matches PostgreSQL.
- Preserve identifiers, relationships, unique constraints, timestamps, enum values, nullable fields and JSON content. Check generated Prisma types after conversion.
- Keep PostgreSQL migration history intact. D1 needs its own SQLite migrations and Wrangler workflow; do not run the existing PostgreSQL migration SQL against D1.

### Runtime and authentication

- `src/server.ts` connects PostgreSQL and Redis, verifies SMTP, seeds data and starts cron during startup. Workers need an HTTP entry and scheduled handler; provisioning and seeding must become separate repeatable operations.
- `src/app/lib/prisma.ts` exports a global PostgreSQL pool. D1 requires a binding and a D1 adapter; existing imported client access needs a request and scheduled event context strategy.
- `src/app/lib/redis.ts` assumes a persistent TCP client and heartbeat. Replace its usages with explicit Durable Object operations rather than a partial Redis emulation.
- `src/app/module/auth/auth.service.ts` uses Lua for refresh rotation and session invalidation, Redis TTLs and `getDel` for reset tokens. Preserve atomic single use, all-session invalidation, OTP attempt limits, resend cooldown and expiry. Expiry must be checked at access time, not only by delayed cleanup.
- Native `bcrypt` is imported by authentication, user, staff, manager and seed code. Validate `bcryptjs` against existing password hashes and benchmark the configured cost in Workers before replacing imports.
- Authentication reads EJS templates from source filesystem paths. Bundle the templates and render their contents; preserve email content and escaping.
- `src/app/config/env.ts` requires PostgreSQL and Redis URLs at import time. Split Node and Worker configuration and validate Worker bindings/secrets without requiring obsolete URLs.
- `src/app/lib/r2.ts` validates credentials at import time. Preserve the existing R2 presign flow while ensuring configuration is available before module initialization.
- Keep the raw-body Stripe webhook route before JSON parsing in `src/app.ts`. Verify signature validation through the Worker HTTP adapter.
- Cookies currently use `sameSite: "lax"`. Verify frontend and API domain placement, CORS credentials, secure cookies and refresh flows using the actual staging domains.

## Migration sequence and acceptance criteria

1. Capture representative API responses and fixtures from a disposable PostgreSQL and Redis test environment. Use synthetic users and payment provider test mode. Cover errors as well as successful requests.
2. Prove the highest risk path first: one booking payment, wallet spend and refund on local D1, including simultaneous requests and injected failures. Finalize transaction ownership and recovery before migrating all CRUD modules.
3. Build a separate D1 schema, serialization layer and migration set. Reconcile row counts, foreign keys, money totals, array ordering and timestamps from a test export. Keep the original database recoverable.
4. Implement Durable Object authentication operations, including access-time expiry and atomic refresh/reset token consumption. Decide explicitly whether existing Redis sessions will be migrated or require a planned login reset.
5. Add Workers entry, scheduled jobs, secrets/bindings and bundled email templates. Retain the current Node runtime as a regression reference while the Cloudflare path is validated.
6. Compare behavior on staging: routes, response shape, status codes, pagination, role access, search, image uploads, email, cookies and all financial flows. Repeated webhooks and overlapping cron runs must not duplicate refunds or wallet entries.
7. Before cutover, verify Cloudflare account capabilities, database size and runtime limits against expected workload. Use a controlled write freeze for final data reconciliation. Test rollback before allowing new production writes; switching back to an old database after new writes requires data reconciliation.

## Documentation

- [Express on Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Prisma D1 deployment guide](https://www.prisma.io/docs/guides/v7/deployment/cloudflare-d1)
- [Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/)
