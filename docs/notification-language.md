# In-app notification language

Notification responses use the app's requested language: `en`, `zh-CN` or `zh-HK`. This change is limited to in-app notification copy and language resolution. Existing recipients, access checks, read flags, pagination, transactions, schedules, booking/payment/refund rules and email routing remain unchanged. No schema or migration is needed for this change.

The frontend must send its selected language on every notification request. For example, with the existing authenticated session or bearer token:

```http
GET /api/v1/notifications?lang=en&page=1&limit=20
GET /api/v1/notifications?lang=zh-CN&page=1&limit=20
GET /api/v1/notifications?lang=zh-HK&page=1&limit=20
```

Alternatively send `Accept-Language: zh-HK` (or the other supported language). An explicit `lang` query takes priority; otherwise the existing middleware negotiates the header, including its quality weights. The default is English. `Content-Language` identifies the chosen language and `Vary: Accept-Language` is retained. Mark-read/read-all success messages use the same language selection.

On an app language change, refetch the list and include language in any frontend cache key. A backend cannot infer an app's UI language when requests keep sending the old language. The frontend lives in a separate repository and was not edited here.

New notifications retain all supported translations, including wallet confirmation, policy cancellation/refund, refund review and group-reservation expiry paths. Team notifications use translated titles and service names. Branch status notifications use the branch's selected-language name. A missing name translation uses a localized generic label rather than borrowing another language. Explicit configured names, identifiers, currency codes and merchant-written notes remain verbatim; they are not machine-translated.

Old records are localized on read without rewriting history. Known historical formats are reconstructed from their stored fields. Missing or partial translations do not fall back to another language. Unknown historical copy displays a localized notice explaining that the original content needs another language; the original stored content remains intact. No financial amount or scheduling detail is invented to translate an unknown format.

Local checks: `npm run test:notifications`, `npm run typecheck`, `npm run test:regression`. Worker API tests also verify language-query/header conflicts, weighted headers, customer/team notifications and unchanged stored records after language changes. Tests use mocked external services and disposable local databases; they do not deploy or send real email.

Verification on 2026-10-30: notification tests **18/18 passed**; full regression **314/314 passed**, no failures/skips, exit 0. The regression includes Node compilation, disposable Worker API/SQLite/migration checks, financial/booking/AUTO tests and the existing route-contract inventory. TypeScript no-emit validation passed. The final historical-name fallback refinement also passed the focused notification suite. No deployment, live database change, email flag change or real email was performed.
