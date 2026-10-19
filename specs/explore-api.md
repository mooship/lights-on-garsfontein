# API exploration plan

Exploratory probe of the Worker's HTTP API, run with curl against `wrangler dev --env e2e` at `http://localhost:8790` on 19 October 2026. Tokens are the local values from `.dev.vars.example`. No successful heartbeat was posted, because the e2e database has no way to reset the heartbeat row (see `e2e/fixtures.ts`); heartbeat cases that would pass validation were analysed from the code instead and are marked "(code)".

Each case gives the request, the expected result, the actual result, and whether a test already covers it: **[covered]** (an existing test in `test/`, `e2e/` or `bruno/`) or **[new]**. A **DEFECT** tag marks a result that contradicts README, AGENTS.md or sane HTTP behaviour.

Unless a case says otherwise, every Worker JSON response had `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, the six Worker security headers, and an error body of `{ "error": <code from shared/errors.ts> }` (plus `details` on `bad_request`). No 500 was produced.

**Status:** a record of 19 October 2026. Defects marked "fixed in #29" were fixed in pull request #29; the others were still open when this note was added.

## Cross-cutting

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| X1 | `PUT/DELETE/PATCH/POST /api/status` | 405 with `Allow: GET, HEAD` | 404 `not_found` | [new] DEFECT (low) |
| X2 | `OPTIONS /api/status` with `Origin` and `Access-Control-Request-Headers: x-foo` (CORS preflight) | 204 with `Access-Control-Allow-Origin: *` and allowed methods, as the API is advertised as CORS-open | 404 JSON, no CORS headers | [new] DEFECT (low) |
| X3 | Same wrong-method cases on every API route (heartbeat, pause, timer, outages, login, logout, contact) | 405 | 404 `not_found` | [new] (same root as X1) |
| X4 | `POST /feed.xml`, `/og.png`, `/robots.txt`, `/sitemap.xml`, `OPTIONS /feed.xml` | 405 with `Allow` | 405 from the assets layer, empty body, no `Allow` header, the HTML page CSP | [new] info: platform behaviour, inconsistent with X1 |
| X5 | `GET /api/status/` (trailing slash) | 404 JSON | 404 JSON | [new] |
| X6 | `GET /API/status` | Not the API | Asset 404 HTML page (path is outside `API_PREFIX`) | [new] info |
| X7 | `GET /api/Status`, `/api/%73tatus` | 404 JSON | 404 JSON | [new] |
| X8 | `GET //api/status` | Redirect or 404 | 307 to `/api/status` (assets layer) | [new] info |
| X9 | `GET /api/../api/status`, `--path-as-is /api/x/../status`, `/api/%2e%2e/api/status` | Normalised to `/api/status` | 200 status JSON | [new] |
| X10 | `GET /../../etc/passwd` | 404 page | Asset 404 HTML | [new] |
| X11 | `GET /api/status?<20 000 chars>` | 200, query ignored | 200 | [new] |
| X12 | `GET /api/<20 000 chars>` | 404 JSON | 404 JSON | [new] |
| X13 | `GET /api/`, `GET /api` | 404 JSON; `/api` is outside the prefix | 404 JSON; `/api` gets the HTML 404 | [new] |
| X14 | Security headers on 400, 401, 403, 404, 409, 415, 429 | All six Worker headers | Present on every one | [covered] `test/headers.test.ts` (404, 500); [new] for 400/401/403/409/415/429 |
| X15 | 401 responses (bearer endpoints) | `WWW-Authenticate: Bearer` (RFC 9110 §11.6.1) | Header absent | [new] DEFECT (low) |
| X16 | Error responses `Cache-Control` | `no-store` | `no-store` on every error, including errors on the public cached routes | [new] |
| X17 | Error `details` on `bad_request` for ISO times | Short issue | Includes zod's full datetime regex (`pattern`), about 600 bytes | [new] info |
| X18 | `CF-Connecting-IP` spoofing | Overwritten by Cloudflare in production | Honoured locally (used to get fresh rate-limit buckets) | info, matches `uniqueIp` |

## GET /api/status

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| S1 | `GET` | 200, `no-store`, CORS `*`, fields per `StatusResponse` | As expected | [covered] status.test.ts, bruno |
| S2 | `HEAD` | 200, same headers, no body | As expected | [covered] |
| S3 | `GET ?x=1&y=<script>` | Same cached body | Same | [covered] query string ignored |
| S4 | With two open outages (see A3) | One open outage at most | `outage` is the newer one; after one punch in, still OFF from the other | [new], see A3. Fixed in #29: a second open outage is refused |

## GET /api/stats, /api/outages.csv, /feed.xml

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| H1 | `GET /api/stats` | `public, max-age=60`, CORS | As expected | [covered] |
| H2 | `GET /api/outages.csv` | `text/csv`, attachment name `lights-on-garsfontein-outages.csv`, `max-age=300` | As expected | [covered] |
| H3 | CSV with zero-length outage (end = start) | `duration_minutes` 0 | 0 | [new] |
| H4 | CSV with a year-0001 outage | Row sorts first | `6,0001-01-01T00:00:00.000Z,...,60,no` first | [new], see A6 |
| H5 | `GET /feed.xml` empty and with entries | Valid Atom | As expected | [covered] feed.test.ts |
| H6 | `HEAD` on all three | 200, headers, no body | As expected | [covered] for feed, [new] for stats and CSV |
| H7 | `?nocache=<random>` on all three | Served from the same cache key | 200, same body | [covered] for status only; [new] for these three |
| H8 | `OPTIONS`, `POST` on `/api/stats`, `/api/outages.csv` | 405 | 404 JSON | [new], X1 |
| H9 | `Cross-Origin-Resource-Policy: same-site` on CORS-open routes | Does not block CORS `fetch` | Present; affects only no-cors embeds | info |

## POST /api/heartbeat

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| B1 | No `Authorization` | 401 | 401 | [covered] |
| B2 | `Bearer nope` six times from one IP | 401 ×5 then 429 with `Retry-After: 60` (LOGIN_LIMITER) | As expected | [covered] for admin token; [new] for heartbeat token |
| B3 | `Bearer ` (empty token) | 401 | 401 | [new] |
| B4 | `bearer <valid token>` (lower-case scheme) | Accepted: the scheme is case-insensitive (RFC 9110 §11.1) | 401 | [new] DEFECT (low), fixed in #29 |
| B5 | `Basic ...` | 401 | 401 | [new] |
| B6 | `Bearer <ADMIN_API_TOKEN>` | 401 | 401 | [new] |
| B7 | No auth, `Origin: https://evil.example` | 403 | 403 (cross-site guard runs before auth) | [new] |
| B8 | No auth, form body | 415 | 415 | [new] |
| B9 | JSON bodies: empty, `null`, `[]`, `"x"`, truncated | 400 `invalid_json` / `bad_request` | As expected | [covered] partially (`rejects a poweredFor...`); [new] for non-object bodies |
| B10 | `poweredFor`: -1, 1.5, "60", null, true, 1e20, 2^53, -0.0001 | 400 `bad_request` | As expected | [covered] for -1, 1.5, "60"; [new] for the rest |
| B11 | Duplicate key `{"poweredFor":5,"poweredFor":-1}` | Last wins | 400 (last wins) | [new] |
| B12 | `poweredFor: 9007199254740991` (max safe int) (code) | Should be bounded; it dismisses every open sensor outage since 1970 | Accepted: `poweredSince` clamps to epoch | [new] note: consider a cap (for example a year) |
| B13 | `Content-Type: Application/JSON` with a body (code) | Body parsed | `startsWith('application/json')` is case-sensitive: body silently ignored, heartbeat recorded with `poweredFor` 0 | [new] DEFECT (low), fixed in #29 |
| B14 | `Content-Type: application/jsonx` (code) | Body ignored or 415 | Parsed as JSON (prefix match) | [new] info |
| B15 | 5 MB JSON body with invalid `poweredFor` | 413 or 400 | 400 (parsed in full; no size cap) | [new] info |
| B16 | `GET/PUT/DELETE` | 405 | 404 | [new], X1 |

## POST /api/heartbeat/pause

No heartbeat row exists in the e2e database, so every valid pause answered `{ "ok": true, "pausedUntil": null }` (documented: "does nothing before any sensor has reported").

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| P1 | `until: null` | 200, `pausedUntil: null` | As expected | [covered] |
| P2 | Past, now minus 1 min | 400 `time_in_past` | As expected | [covered] |
| P3 | Now plus 1 min; 30 days minus 1 min | 200 | 200 | [covered] |
| P4 | 30 days plus 1 min | 400 `pause_too_long` | As expected | [covered] |
| P5 | `2026-13-01`, `2026-02-30`, `T24:00:00Z`, no offset, date only, `+02`, `+0200`, space separator, lower-case `t`/`z`, `""`, a number, full-width digits | 400 | 400 | [covered] partially; [new] for the format variants |
| P6 | `+14:00`, `+23:59`, `-23:59`, nanoseconds `.123456789Z` | 200 | 200 | [new] |
| P7 | `{}` (missing `until`) | 400 | 400 | [new] |
| P8 | Extra field | 200, ignored | 200 | [new] |
| P9 | No `Content-Type`, or `text/plain`, with bearer | Accepted (bearer exempt from the JSON check) | 200 | [new] |
| P10 | No body | 400 `invalid_json` | 400 | [new] |
| P11 | UTF-8 BOM before the JSON | 200 | 200 | [new] |
| P12 | 200 000-deep nested arrays | 400, not 500 | 400 `bad_request` | [new] |
| P13 | 90 MB JSON body | 413 | 200 (parsed in full) | [new] info: no size cap on any route |
| P14 | Invalid UTF-8 bytes in `until` | 400 | 400 | [new] |
| P15 | Admin token | 401 | 401 | [new] |

## POST /api/admin/outages

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| A1 | `create` closed | 201 | 201 | [covered] |
| A2 | `create` open while none is open | 201 | 201 | [covered] |
| A3 | `create` open while another is open | 409 `outage_already_open`, as punch out does | 201; two open outages. Status shows OFF from the newer one; one `punch_in` closes only the newest and the status stays OFF until a second `punch_in` | [new] DEFECT (medium), fixed in #29: 409 `outage_already_open` |
| A4 | `update` `endTime: null` on a closed outage (weeks old) while another is open | 409, or at least refused while another is open | 200; outage reopened, status OFF "since 4 October" | [new] DEFECT (medium, same root as A3), fixed in #29 |
| A5 | `create` with end = start (zero length), including equal instants in different offsets | Either 400 or accepted | 201; CSV `duration_minutes` 0 | [new] |
| A6 | `create` `0001-01-01T00:00:00Z` | A floor (for example not before some sane year) | 201; listed first in CSV | [new] DEFECT (low) |
| A7 | `create` `9999-12-31` | 400 `time_in_future` | As expected | [covered] |
| A8 | `create` end before start only once offsets are applied | 400 `end_before_start` | As expected | [new] |
| A9 | `create` no offset, `isPlanned` "true" or null, `startTime` null | 400 | 400 | [new] |
| A10 | `create` with `source: "sensor"`, `isFalsePositive: true`, `id: 999` | Refused, or ignored visibly | 201; extra fields silently stripped (`source: manual`, new id) | [new]; fixed in #29: admin bodies are strict, so 400 |
| A11 | Response shape of `create`, `update` and `timer` | `AdminOutage` (`planned`), like the list | Raw row with `isPlanned` and no `planned`; the list uses `planned` | [new] DEFECT (low) |
| A12 | `update` nonexistent id | 404 | 404 | [covered] |
| A13 | `update` id "1", 0, -1, 1.5, 1e300, 2^53+1 | 400 | 400 | [new] |
| A14 | `update` with no changes | 200, unchanged | 200 | [new] |
| A15 | `update` an already closed outage's `endTime` | 200 | 200 | [covered] |
| A16 | `update` with `startTime` | 400 (not editable), or edited | 200 and nothing changed: the admin is told it worked | [new] DEFECT (low), fixed in #29: 400 |
| A17 | `update` `isFalsePositive: true` on an open outage | Closes it | Closes it | [covered] |
| A18 | `update` `isFalsePositive: true, endTime: null` | Closed (the handler's own rule: "a false positive should not stay open") | 200; stays open with `isFalsePositive: true` | [new] DEFECT (low), fixed in #29: false positives always close |
| A19 | `delete` then `delete` again | 200 then 404 | As expected | [covered] partly; [new] for the repeat |
| A20 | `delete` id "5", missing id | 400 | 400 | [new] |
| A21 | `delete` with extra `endTime: "bogus"` | 200, ignored | 200 | [new] |
| A22 | Duplicate `action` key (`delete` then `update`) | Last wins | Treated as `update` | [new] |
| A23 | `action: "Create"`, missing action, array body | 400 | 400 | [new] |
| A24 | `PUT/DELETE/PATCH`, `/outages/`, `/outages/1` | 405 / 404 | 404 | [new] |
| A25 | `GET ?limit=1000` | Ignored, 50 max | Ignored | [new] |
| A26 | `HEAD` | 200, no body | 200 | [new] |

## POST /api/admin/timer

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| T1 | `punch_out` while open | 409 `outage_already_open` | As expected | [covered] |
| T2 | `punch_in` with none open, twice | 409 `no_open_outage` | As expected | [covered] |
| T3 | `PUNCH_IN`, null, `{}`, string body | 400 | 400 | [covered] partly |
| T4 | Extra field | Ignored | Ignored | [new] |
| T5 | `GET` | 405 | 404 | [new], X1 |

## Admin auth and cookies

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| C1 | Login, then the cookie on `GET /api/admin/outages` | 200 | 200 | [covered] |
| C2 | Cookie write with `Origin` cross-site, `null`, `Sec-Fetch-Site: same-site` | 403 | 403 | [covered] |
| C3 | Cookie write with `text/plain`, no `Content-Type`, `application/json-patch+json`, form | 415 | 415 | [covered] partly; [new] for `json-patch+json` |
| C4 | Cookie write with `Application/JSON;charset=UTF-8` | Accepted | Accepted | [covered] |
| C5 | Cookie plus wrong bearer | 401, no fallback | 401 | [covered] |
| C6 | Forged token of the right shape; malformed; 7 KB value; without `__Host-` prefix; spaces around `=` | 401 | 401 | [covered] partly; [new] for the variants |
| C7 | Cookie header with a bad `__Host-admin_session` first, the real one second | 401 (first wins) | 401 | [new] info |
| C8 | Logout cross-site; with a form body | 403; 415 | As expected | [new] |
| C9 | Logout with no cookie | 200, clears cookie | As expected | [new] |
| C10 | Old cookie after logout | 401 | 401 | [covered] |
| C11 | Login with `Sec-Fetch-Site: cross-site` | 403 before the rate limit | 403 | [new] |
| C12 | Login with 200-character username | 400 | 400 | [new] |
| C13 | Any `Authorization: Bearer x` header on `/api/contact` or `/api/admin/login` | Same-site and JSON checks still apply: these routes verify no bearer token | Bypassed: cross-site `Origin` gets 200 with the email (Turnstile still runs). Not exploitable from a browser (the header forces a failing preflight) | [new] DEFECT (low, defence in depth), fixed in #29: a bearer header exempts a write only on routes that check the token |

## POST /api/contact

| # | Request | Expected | Actual | |
|---|---|---|---|---|
| K1 | Valid token | 200 `{ email }`, `no-store` | As expected | [covered] |
| K2 | `{}`, token over 2048 chars | 400 | 400 | [covered] |
| K3 | Cross-site | 403, no CORS | 403 | [covered] |
| K4 | 12 requests from one IP (e2e limit 10/min) | 10 × 400 then 429 with `Retry-After: 60` | As expected | [covered] |
| K5 | 8 KB, `::::::::::::` or empty `CF-Connecting-IP` | No 500 | 400 | [new] |
| K6 | `OPTIONS` | 404 (not CORS-open, by design) | 404 | [new] |

## Cases to automate first

1. Done in #29. **A3/A4**: `create` with no `endTime`, or `update` with `endTime: null`, while another outage is open, answers 409 `outage_already_open` (worker test in `test/admin.test.ts`; bruno request in `bruno/admin/`).
2. **A11**: `create`, `update` and `timer` answer with the `AdminOutage` shape (`planned`, no `isPlanned`), checked against the list's item for the same id.
3. Done in #29. **A18**: `update { isFalsePositive: true, endTime: null }` on an open outage leaves it closed (or is refused).
4. Done in #29. **A16/A10**: unknown fields in admin bodies are refused with 400 (`z.strictObject`), so an attempted `startTime` edit does not report success.
5. **X1/X2**: wrong method on a known API path answers 405 with `Allow`; `OPTIONS` on a CORS route answers the preflight. Extend `test/router.test.ts`.
6. B4 done in #29; X15 still open. **X15/B4**: 401 carries `WWW-Authenticate: Bearer`; the bearer scheme is matched case-insensitively (`test/http.test.ts` for `bearerToken`).
7. Done in #29. **B13**: a heartbeat with `Content-Type: Application/JSON; charset=UTF-8` and `{"poweredFor":600}` dismisses an open sensor outage, like the lower-case header.
8. Done in #29. **C13**: `POST /api/contact` with `Authorization: Bearer x` and a cross-site `Origin` answers 403.
9. **X14**: extend `test/headers.test.ts` to a 400, 401, 403, 409, 415 and 429.
10. **H6/H7**: `HEAD` and query strings on `/api/stats` and `/api/outages.csv`.
