# Exploratory browser test plan

Explored on 19 Oct 2026 against `wrangler dev --env e2e` at http://localhost:8790 with the Playwright MCP browser. Seed: `e2e/seed.spec.ts` (English, no outages, via `e2e/fixtures.ts`).

Each scenario is marked **[covered]** (an existing test in `e2e/app.spec.ts` already checks it) or **[new]**. Scenarios that reproduce an observed defect are marked **(DEFECT)**.

Note: during the session another client was also writing outages to the same local database, so do not rely on the database being empty without the `resetOutages` fixture.

## 1. Language

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 1.1 | Afrikaans by default | New context, open `/` | `lang="af"`, Afrikaans status | [covered] |
| 1.2 | Toggle to English, reload, toggle back, Back | As in "switches to English at once…" | URL, lang and stored choice follow | [covered] |
| 1.3 | Stored English redirects `/` to `/en/` keeping the query | `/?from=share` | `/en/?from=share` | [covered] |
| 1.4 | Toggle keeps the query string | Open `/en/?utm_source=x`, click "Afrikaans" | URL is `/?utm_source=x` (the boot redirect keeps queries, so the toggle should too) | [new] (DEFECT: lands on `/`) |
| 1.5 | Forward after Back | `/en/` → toggle → Back → Forward | Forward returns to `/`, Afrikaans, stored `af` | [new] |
| 1.6 | `/en` redirect | GET `/en` | 307 to `/en/` | [covered] |
| 1.7 | Case and odd locale paths | GET `/EN/`, `/En/`, `/af/` | 404 page (bilingual), not a blank app | [new] |
| 1.8 | `/index.html`, `/en/index.html`, `/en//`, `//en/` | GET without redirects | 307 to `/`, `/en/`, `/en/`, `/en/` | [new] |
| 1.9 | Unknown `?lang=xx` is ignored | Open `/?lang=xx#frag` | Afrikaans page, no errors | [new] |

## 2. Theme

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 2.1 | Follows system theme before the app loads | dark colour scheme, JS assets aborted | `html.dark` | [covered] |
| 2.2 | Saved preference beats system; toggle persists | | | [covered] |
| 2.3 | Theme carries to `/privacy` and the 404 page | Toggle to dark on `/en/`, open `/privacy`, then `/nope` | Both dark, body background is the dark palette | [new] |
| 2.4 | `meta[name=theme-color]` follows the toggle | Toggle twice | Matches the palette background each time | [new] |
| 2.5 | Reduced motion | `reducedMotion: 'reduce'` | No element has an animation or transition longer than 10 ms | [new] |

## 3. Status card and API robustness

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 3.1 | 500 on first load | | "Unable to reach the server" alert | [covered] |
| 3.2 | Later poll fails | | Last status kept, stale warning | [covered] |
| 3.3 | Hanging request | | Gives up after `REQUEST_TIMEOUT_MS` | [covered] |
| 3.4 | 429 and HTML 502 on first load | Route `/api/status` to 429 JSON, then 502 `text/html` | Unreachable alert in both | [new] |
| 3.5 | 200 with a body that is not JSON (truncated JSON, empty body, captive-portal HTML) | Route `/api/status` to `200 text/html "<html>login</html>"` | Unreachable alert, then recovery on the next good poll | [new] (DEFECT: stuck on "Loading the current status…", page error `Cannot read properties of undefined (reading 'find')`) |
| 3.6 | Recovery after a bad first response | First status response empty 200, then real | Next poll (`POLL_MS`) renders the real status | [new] (DEFECT: never recovers, even after a good poll) |
| 3.7 | Unexpected shapes: `{}`, `[]`, `recent: null`, `recent: [null]` | Route each | Unreachable alert, no page error | [new] (DEFECT: same crash) |
| 3.8 | Unknown `status` value | `status: "BROWNOUT"` | Neutral "No outage reported", neutral title | [new] (DEFECT: blank headline, tab title `undefined · Lights On?`) |
| 3.9 | Invalid `since` | `status: ON, monitored: true, since: "not-a-date"` | No "for NaN s" | [new] (DEFECT: "for NaN s") |
| 3.10 | `since` in the future | `since` = now + 1 h | Not "for 0 s"; treat as no duration | [new] |
| 3.11 | Stale reading | | No "on" past `HEARTBEAT_THRESHOLD_MS` | [covered] |
| 3.12 | Leftover service worker from the removed offline build | Register a worker that answers `/api/status` from cache on a 5xx (as the old `sw.js` did), make the server return 500 | Unreachable alert; never a cached status presented as current | [new] (DEFECT, see report) |
| 3.13 | Overnight outage in "Recent outages" and the last-outage line | Log 17 Oct 22:00 to 18 Oct 02:30 | Shows the end day, e.g. "Sat 17 Oct 22:00 to Sun 18 Oct 02:30" | [new] (DEFECT: "22:00 to 02:30", and "09:00 to 07:40 yesterday") |

## 4. Statistics and charts

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 4.1 | Weekly chart: Home and arrows | | | [covered] |
| 4.2 | Hour chart opens on worst hour, arrows move | | | [covered] |
| 4.3 | Arrow keys stop at the ends, no wrap | Focus weekly chart, ArrowLeft past the first week; hour chart ArrowLeft at 00:00 | Stays on the first item; End jumps to the last | [new] |
| 4.4 | Pointer hover selects an hour; leaving keeps the selection | Hover a bar in the hour chart, move away | Readout shows the hovered hour and stays | [new] |
| 4.5 | Stats 500 | | Card keeps shape | [covered] |
| 4.6 | Stats 200 with a non-JSON or partial body | Route `/api/stats` to `garbage` or `{"trackingSince":null}` | "Could not load" message, card keeps its shape | [new] (DEFECT: card body disappears, page error `reading 'map'`) |

## 5. Share, footer, privacy

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 5.1 | WhatsApp, Telegram, share sheet, copy | | | [covered] |
| 5.2 | Afrikaans share text and URL | `appLocale: 'af'` | Links use the Afrikaans text and `site.url/` | [new] |
| 5.3 | Footer "Sign in" link | Public footer | Links to `/admin` in both languages | [new] |
| 5.4 | Contact reveal (English) | | | [covered] |
| 5.5 | Contact reveal in Afrikaans | `#af` section | Email shown and focused | [new] |
| 5.6 | Contact errors | Route `/api/contact` to 429 and 500 | Button stays, GitHub fallback shown | [new] |
| 5.7 | Contact 200 without `email` | Route to `{}` | No `mailto:undefined` link | [new] (DEFECT, low) |

## 6. Odd URLs and 404

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 6.1 | Unknown path 404 page | | | [covered] |
| 6.2 | 5000-character path, encoded emoji path, `/%`, `/%2e%2e/...` | GET each | 404 page (or 307 to `/%25`, then 404), no 5xx | [new] |
| 6.3 | `/admin/` and `/privacy/`, `/privacy.html` | GET | 307 to `/admin`, `/privacy` | [new] |
| 6.4 | Unknown API path | GET `/api/nope` | 404 JSON `{"error":"not_found"}` | [new] |
| 6.5 | No horizontal scroll at 320px with outages on record, including `/nope` and `/admin` signed in | | scrollWidth equals clientWidth | partly [covered] (no outage data, no 404 page) |

## 7. Admin

| # | Scenario | Steps | Expected | Mark |
| --- | --- | --- | --- | --- |
| 7.1 | Wrong password | | | [covered] |
| 7.2 | Empty fields | Click Sign in with empty fields | Native required validation, no request | [new] |
| 7.3 | Password longer than the server limit (256) | Fill 10 000 characters, sign in | `maxlength` on the field, or "Incorrect username or password." | [new] (DEFECT: shows "Check the times and try again. Times cannot be in the future.") |
| 7.4 | Login 429, Turnstile failure, HTML 500, network abort | Route `/api/admin/login` | `admin.errors.rate_limited`, `turnstile_failed`, `requestFailed('http_500')`, `network`; password kept | [new] |
| 7.5 | Real rate limit | Use a fresh rate-limit bucket; six wrong attempts in a minute | Sixth shows `rate_limited` | [new] (Worker test territory: prefer `stubLimiter`) |
| 7.6 | Sign out | | | [covered] |
| 7.7 | Session cookie deleted mid-session | Sign in, clear cookies, click "Close now" | Sign-in form, `session_expired` alert, focus on the sign-in heading | [new] |
| 7.8 | Punch out and in drive the public status | | | [covered] |
| 7.9 | Log a past outage | | | [covered] |
| 7.10 | End before start, end equal to start | | `end_before_start` alert | [new] |
| 7.11 | Future end | Start 06:00 today, end 23:00 today | `bad_request` alert | [new] |
| 7.12 | Future start blocked by the browser clears the old alert | Trigger 7.10, then a future start | No stale "end must be after the start" alert | [new] (DEFECT, low: stale alert stays) |
| 7.13 | Log with an empty end while an outage is open | Punch out, then log a past start with no end | `outage_already_open` | [new] (DEFECT: a second open outage is created) |
| 7.14 | Two open outages and the punch clock | Two open outages from 7.13, press Punch in | Public status ON, no open outage left | [new] (DEFECT: one stays open; public stays OFF; clock shows "Off since…" beside "Punched in at…") |
| 7.15 | Overlapping outages | Log 10:00–11:00 inside an existing 09:00–12:00 | Rejected, or the README states overlaps are allowed | [new] (accepted silently) |
| 7.16 | False positive and Planned toggles | Toggle each, reload | `aria-pressed` persists; public list hides false positives, marks planned | partly [covered] (focus only) |
| 7.17 | Delete dismissed vs accepted | Dismiss the confirm, then accept | Dismissed: item stays, focus on Delete. Accepted: item gone, focus moves to the next Delete | [new] |
| 7.18 | Keyboard-only sign-in | Tab order: theme, Public page, Username, Password, Sign in, footer links; every stop has a visible outline | | [new] |
