# Merchant email provider configuration

**Current v24 policy:** all automatic business-email triggers and processing are retired, even if the outbox flag is accidentally true. Platform OTP/reset email and explicit owner provider tools remain. See [current retirement documentation](transactional-email-system.md). Earlier automatic-delivery guidance below is historical and does not authorize activation.

Permanent v23 outbox management, freshness rules, owner audit/history APIs and deployment gates are documented in [transactional-email-system.md](transactional-email-system.md#permanent-outbox-management-upgrade-v23-local-candidate). Delivery remains disabled; historical test evidence below predates this upgrade.

The subsequent approved transactional-email task is documented in [transactional-email-system.md](transactional-email-system.md), including the additive v22 delivery-fence migration, event hooks, disabled-by-default scheduler, operations and final test evidence. Earlier provider-only test counts below are historical. Staging API access must remain online while implementation/build checks run locally.

## Audit and Gmail diagnosis

The supplied log shows `ESOCKET`, command `CONN`, and no SMTP response code. This is a connection/TLS failure before authentication. It does not prove that an App Password is wrong. The precise production socket/TLS cause remains unconfirmed because the old log discarded the underlying cause and no authorized real send has been performed.

The confirmed implementation defect is that merchant SMTP used direct Nodemailer TCP/TLS on Workers, bypassing the repository's existing Cloudflare socket implementation. Platform OTP/reset email already had a Worker-specific transport. Node and Workers now use separate adapters for the same merchant-provider service. Workers connects through `cloudflare:sockets` with implicit TLS on port 465. Merely enabling `nodejs_compat` or changing a password is not a substitute for this adapter.

Cloudflare permits outbound TCP/TLS with destination restrictions and prohibits port 25. Provider-side policies may still reject a datacenter connection. A port-465 implementation passing mocked tests does not prove Gmail/QQ/163 connectivity or delivery from the deployed account. Sources: [Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

Existing strengths preserved: AES-256-GCM credential encryption; JWT role checks; single-brand access checks; response envelopes; platform-controlled password-reset/OTP transport; existing Resend REST test; Durable Object serialization and immutable migrations. Previously incomplete: Microsoft OAuth, production Resend domain readiness, custom SMTP outbound validation, request rate limiting and safe SMTP diagnostic classification.

## Provider implementations and limits

| Provider | Implemented | External verification still required |
| --- | --- | --- |
| Gmail | App Password, whitespace normalization, fixed smtp.gmail.com:465, TLS, sender=authenticated identity, direct accepted-message verification | One approved send from deployed Workers; inbox receipt |
| QQ | Authorization code, fixed smtp.qq.com:465, TLS, direct verification | SMTP enabled/authorization code and approved send |
| NetEase 163 | Authorization code, fixed smtp.163.com:465, TLS, direct verification | SMTP enabled/authorization code and approved send |
| Microsoft 365 | Server authorization-code flow, PKCE, encrypted one-time state, delegated identity, encrypted tokens, refresh/rotation, Graph sendMail, local disconnect | Entra registration, consent, matching sender identity and approved send |
| Custom SMTP | Node transport: all DNS results must be public IPv4, vetted IP pinned to socket, original TLS servername, mandatory TLS/STARTTLS, ports 465/587/2525 | Owner-controlled Node deployment and provider credentials; **arbitrary custom SMTP is disabled on Workers** |
| Resend | Existing/new sender-domain discovery, DNS records, verify/status, strict exact sender-domain match, domain readiness before enable, REST sending | Domain management permission, DNS verification, approved send |

Custom SMTP rejects IP literals, loopback, private, link-local, multicast, metadata, IPv4-mapped IPv6, IPv6, reserved and special ranges. Mixed public/private DNS answers are rejected. Only the vetted address is passed to Node's TCP/TLS socket, preventing a second lookup/rebinding. Certificate verification remains enabled. Unsupported IPv6/custom Worker configurations fail closed. Safe alternatives are the existing Node runtime with the same merchant credentials or a supported provider's direct API; no SMTP relay or third-party credential handoff has been added. A future dedicated delivery service requires a separate approved design.

Microsoft uses `offline_access User.Read Mail.Send` only. `/me` must match the configured sender; refresh must retain the same account ID. State expires in ten minutes, is consumed once, and is bound to requester, brand, redirect URI and configuration version. Callback rechecks the owner's active role. A provider switch/disconnect invalidates outstanding state. Invalid refresh/Graph authorization requires reauthorization and disables the configuration. Disconnect removes local tokens and disables sending. It does **not** claim to revoke all Microsoft sessions: broad `revokeSignInSessions` permissions are intentionally not requested. Remove the application's consent through Microsoft's My Apps portal for provider-side revocation. Sources: [authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

Resend sandbox `onboarding@resend.dev` remains usable for a direct test subject to Resend restrictions, but can never become production verified/enabled. Production needs a verified domain with sending enabled and an exactly matching sender domain. API-key acceptance alone never verifies a domain. Use an API key authorized for domain management as well as sending. Sources: [create domain](https://resend.com/docs/api-reference/domains/create-domain), [retrieve domain](https://resend.com/docs/api-reference/domains/get-domain), [verify domain](https://resend.com/docs/api-reference/domains/verify-domain).

## State, separation and delivery semantics

- Save/credential update/provider switch resets enabled/verified state and clears provider-specific OAuth/domain metadata. Supplying no credential retains it only for the same provider; switching providers requires a fresh credential. Gmail, QQ and 163 sender addresses must match the authenticated SMTP identity. Config edits use a version check to reject lost updates.
- Direct `/test-email` never requires enablement and never falls back to platform SMTP. A successful provider test can verify only the same configuration version. Resend production verification additionally requires DNS verification; Microsoft verifies identity during authorization.
- Enable requires verified and production-ready state. Disable retains encrypted credentials. All responses exclude encrypted credentials and OAuth tokens.
- Business-provider resolution uses platform SMTP only when merchant settings are absent, disabled, unverified or unsupported in that runtime. After a merchant send is attempted, failure never triggers platform resend. Timeouts after DATA/request submission are uncertain and are not automatically retried by the sending service.
- OTP, reset and security emails continue importing the existing platform transporter; merchant settings do not affect them.
- The subsequent [transactional email implementation](transactional-email-system.md) adds approved business-event outbox hooks and fenced processing. `EMAIL_OUTBOX_ENABLED=false` keeps live delivery inactive. Only confirmed pre-send/transient failures may retry; ambiguous submissions and crashed SENDING attempts become DELIVERY_UNCERTAIN. No campaigns or email reminders are added.

SMTP logs contain canonical error code, allowlisted source/cause codes, stage (`CONNECT`, `TLS`, `AUTH`, `SEND`), numeric provider status and uncertainty only. They never include raw SMTP replies, provider response bodies, credentials or tokens. Test endpoints use a persistent per-brand/user limit of five attempts per 15-minute window. Domain-status polling is limited to 15; OAuth connect, domain creation/verification and enable are limited separately. Invalid input is rejected before counting; 429 includes Retry-After.

## Environment and deployment

New merchant-only configuration:

| Name | Requirement |
| --- | --- |
| EMAIL_ENCRYPTION_KEY | Persistent random 32-byte key represented as 64 hex characters. Must match existing encrypted merchant credentials. Do not replace an existing key during deployment. |
| MICROSOFT_EMAIL_CLIENT_ID | Entra application ID |
| MICROSOFT_EMAIL_CLIENT_SECRET | Server-side Entra app secret |
| MICROSOFT_EMAIL_TENANT | Optional tenant UUID or `organizations`; defaults to organizations |
| MICROSOFT_EMAIL_REDIRECT_URI | Exact HTTPS backend callback: `/api/v1/brand-email-settings/microsoft/callback`; local HTTP localhost allowed only outside production |

Existing SMTP_HOST/PORT/USER/PASSWORD/EMAIL_SENDER remain platform-only. Register a Web redirect URI in Entra, use delegated permissions above, and grant organizational consent where required. Staging and production need separate appropriate redirect settings and independently managed secrets. Existing secret values were not printed, overwritten or rotated; protected credential/decryption checks consume inputs only in memory.

Use individual `npx wrangler secret put NAME --env staging` commands for **missing** secrets. Do not bulk upload or rotate existing keys casually. Configure production separately. Preserve database identity and existing SMTP/JWT/Stripe secrets. This email candidate has not been deployed and no live pending migration has been executed. The separately authorized P0 restoration of the previous staging application is recorded in the staging restoration report.

Schema changes: existing v19 brand settings; v20 adds the supplied dormant EmailOutbox; v21 adds configurationVersion/providerData/lastTestAt/lastErrorCode. PostgreSQL equivalents are the supplied outbox migration plus `20261028070000_email_provider_configuration`. v21 deliberately disables/unverifies old merchant configurations once, preserving encrypted credentials, because old verification did not prove OAuth identity/domain readiness. Retest and explicitly enable after migration. Repeated initialization does not reset newly verified settings. No database reset or applied-history edits.

## Implementation file map

Modified or added implementation files (repository-relative paths):

- `src/app/lib/merchant-smtp.ts`: Node SMTP adapter, DNS validation and IP-pinned custom sockets.
- `src/app/module/brand-email-setting/brand-email-setting.transport.ts`, `brand-email-setting.errors.ts`, `brand-email-setting.http.ts`: transport contracts, safe diagnostics and bounded HTTP requests.
- In that same module: `brand-email-setting.service.ts`, `brand-email-setting.validation.ts`, `brand-email-setting.access.ts`, `brand-email-setting.rate-limit.ts`, `brand-email-setting.route.ts`, `brand-email-setting.controller.ts`: configuration APIs, access, validation and version checks.
- In that same module: `brand-email-setting.smtp.ts`, `brand-email-setting.resend.ts`, `brand-email-setting.domain.ts`, `brand-email-setting.microsoft.ts`, `brand-email-setting.providers.ts`, `brand-email-setting.test-email.ts`, `brand-email-setting.sender.ts`: provider execution, verification and resolution. Existing API paths are retained.
- `cloudflare/runtime/merchant-smtp.mjs`, `cloudflare/runtime/smtp.mjs`, `cloudflare/worker.mjs`, `scripts/build-cloudflare.mjs`: Worker transport and context; native Node SMTP/DNS code is excluded from the Worker bundle.
- `prisma/schema/brandEmailSetting.prisma`, generated `cloudflare/prisma/schema.prisma`, `cloudflare/runtime/model-metadata.json`, `cloudflare/migrations/0020_email_outbox.sql`, `cloudflare/migrations/0021_email_provider_configuration.sql`, `prisma/migrations/20261028070000_email_provider_configuration/migration.sql`, `scripts/check-cloudflare-schema.mjs`: additive schemas and migrations; the supplied PostgreSQL outbox migration is reused unchanged.
- `src/app/module/brand-email-setting/brand-email-setting.test.ts`, `cloudflare/email-provider.integration.test.mjs`, `cloudflare/runtime/email-test-fixture.mjs`, `cloudflare/smtp.test.mjs`, `cloudflare/runtime/integration-fixture.mjs`, `cloudflare/test-support/public-worker.mjs`, `cloudflare/runtime/database-fixture.mjs`, `cloudflare/runtime/migration-fixture.mjs`, `scripts/test-cloudflare-migrations.mjs`: Node, socket protocol, SQLite and mocked Worker tests.
- `.env.example`, `package.json`, `cloudflare/README.md`, this guide and `docs/merchant-email.postman_collection.json`: setup, test commands and manual requests.

The existing credential-encryption utility and platform auth/password-reset code are reused. The user's existing `src/app.ts` mount is retained. The subsequent transactional task adds transaction-local email hooks to booking/payment/refund/wallet/group-purchase services without changing financial calculations, state transitions, or existing notifications. Its scheduler is integrated but disabled by default; see the transactional implementation for v22 migration, file map and current test evidence.

## Exact Postman workflow

Import `merchant-email.postman_collection.json`. Set `baseUrl` (without trailing slash), `brandId`, and `ownerToken` from the existing login endpoint. The backend is single-brand; any other brand ID is rejected. Use an active BRAND_OWNER token. Do not run the entire collection as an automated delivery runner: direct-test requests send email.

Common endpoints (all require owner bearer auth except OAuth callback):

| Method | Path under /api/v1/brand-email-settings | Body / behavior |
| --- | --- | --- |
| GET | /:brandId | Safe configuration metadata and runtime capabilities |
| PUT | /:brandId | Provider settings below; result disabled/unverified |
| POST | /:brandId/test-email | `{ "recipientEmail": "khanrokon571@gmail.com" }`; direct configured-provider test |
| PATCH | /:brandId/enable | No body; rejects unverified/not-ready state |
| PATCH | /:brandId/disable | No body; encrypted credentials retained |
| POST | /:brandId/microsoft/connect | Returns authorizationUrl; open it in the consenting user's browser |
| GET | /microsoft/callback | Microsoft supplies code/state; never paste tokens into Postman |
| DELETE | /:brandId/microsoft/disconnect | Removes local tokens; response links to consent-removal portal |
| POST | /:brandId/resend/domain | `{ "domain": "salon.example.com" }`; returns DNS records, discovers existing domain or creates one |
| GET | /:brandId/resend/domain | Rechecks provider DNS/status |
| POST | /:brandId/resend/domain/verify | Requests verification, retrieves current status; pending is not success |

Gmail save: `{ "provider":"GMAIL", "fromName":"ABC Hair Salon", "fromEmail":"khanrokon571@gmail.com", "smtpUsername":"khanrokon571@gmail.com", "password":"{{gmailAppPassword}}" }`. Use a Google App Password with two-step verification, not the account password. Spaces in the 16-character App Password are normalized. No password values are included in the collection.

QQ save: `{ "provider":"QQ", "fromName":"ABC Hair Salon", "fromEmail":"{{qqEmail}}", "smtpUsername":"{{qqEmail}}", "password":"{{qqAuthorizationCode}}" }`.

163 save: `{ "provider":"NETEASE_163", "fromName":"ABC Hair Salon", "fromEmail":"{{neteaseEmail}}", "smtpUsername":"{{neteaseEmail}}", "password":"{{neteaseAuthorizationCode}}" }`.

Microsoft save: `{ "provider":"MICROSOFT_365", "fromName":"ABC Hair Salon", "fromEmail":"{{microsoftEmail}}" }`, then connect, browser consent, callback identity check, one approved direct test and enable. Account passwords are rejected. Invalid/expired state cannot be replayed; an expired/revoked token needs reconnect.

Custom save (Node-only sending): `{ "provider":"CUSTOM_SMTP", "fromName":"ABC Hair Salon", "fromEmail":"{{customFromEmail}}", "smtpHost":"{{customSmtpHost}}", "smtpPort":465, "smtpSecure":true, "smtpUsername":"{{customSmtpUsername}}", "password":"{{customSmtpPassword}}" }`. Worker test returns EMAIL_CUSTOM_SMTP_REQUIRES_NODE_DELIVERY; do not bypass it.

Resend save: `{ "provider":"RESEND", "fromName":"ABC Hair Salon", "fromEmail":"{{resendFromEmail}}", "apiKey":"{{resendApiKey}}" }`. Register/check domain, publish returned public DNS records with the domain owner, request verification, wait until verified with sending enabled, send one approved direct test, then enable. No domain is marked verified based on a sandbox send.

Expect 400 invalid input/state, 401 missing auth, 403 role/cross-brand denial, 409 configuration changed, 422 credentials/identity/provider-readiness/custom-runtime limitation, 429 rate limit, 502 provider network/TLS/uncertain send, 503 missing encryption/OAuth setup. After an uncertain error, inspect provider logs and inbox before any retry; do not automatically send again.

## Test evidence and real-test authorization

Automated commands: `npm run typecheck`, `npm run test:smtp`, `npm run test:merchant-email`, `npm run test:cloudflare:migrations`, `npm run test:cloudflare:database`, `npm run test:cloudflare:api`, `npm run test:book-now`, `npm run cloudflare:check`.

All provider, OAuth and domain calls in automated tests are mocked; socket protocol parsing, encryption, configuration persistence, access checks, counters and Worker execution use real local code/SQLite. Mocks do not certify real provider credentials, remote DNS, network reachability, Microsoft tenant consent or inbox delivery.

Latest automated results: TypeScript passed; SMTP protocol 5/5; Node email unit/security 5/5; Worker merchant-provider integration 4/4 (with full API workflow assertions); existing Worker API/remaining-payment integration 6/6; Book Now/regressions 19/19; migration v21 upgrade and database adapter checks passed. Schema drift check and Worker deployment dry-run passed. No real-provider test result is included in these counts.

Real delivery status: **not initiated; pending explicit user confirmation**. Authorized recipient is only `khanrokon571@gmail.com`. Use the existing /test-email endpoint, one test email per configured provider at most, with no retry without separate approval. Missing credentials, OAuth consent or verified domains remain pending. No booking/promotional/bulk email is permitted. After any HTTP success, record only provider acceptance; confirm inbox receipt separately with the user. Never infer inbox receipt from a provider message ID/202 response.

Production review: verify stable encryption key; correct staging/production redirect and consent; DNS ownership and verified Resend sender; fixed-provider SMTP acceptance and inbox receipt; custom SMTP deployment limitation understood; authorization and rate-limit checks; no secret output; migrations backed up/rehearsed; old settings explicitly retested/enabled; outbox/schedules/triggers still inactive. Real provider sign-off remains pending until those external checks pass.
