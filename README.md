# Lights On, Garsfontein?

[![CI](https://github.com/mooship/lights-on-garsfontein/actions/workflows/ci.yml/badge.svg)](https://github.com/mooship/lights-on-garsfontein/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

An open record of power outages for one neighbourhood. The site shows the state of the electricity supply as last recorded at one measuring point and keeps a history of every outage recorded there, so residents, researchers and journalists can see how often the power goes off and for how long. It runs on a single Cloudflare Worker with a D1 database, and the code is written so that anyone can run it for their own area.

**Why this exists.** It is an ultra-local service: it exists only to show the state of the electricity supply in Garsfontein, for the people who live there.

## This deployment

Live at **https://garsfontein.timothybrits.co.za**. Records begin on **17 October 2026**.

> Independent service, operated by a resident of Garsfontein Extension 16. Not affiliated with, endorsed by or speaking for the City of Tshwane or Eskom.

**Area.** The supply is measured at one home in **Garsfontein Extension 16**, near **Mediclinic Denmar**, in Ward 45, Region 6 of the City of Tshwane. Most residents know their ward rather than their extension, so the site names both. Homes there are normally supplied by the **Garsfontein substation**, which is fed from **Highlands**, which in turn is fed from **Njala**. A fault on this part of the network usually affects the Garsfontein substation area as a whole, so the record is usually representative of that area, but some streets can differ. During faults or maintenance, parts of the network can be back-fed from another substation, so a street may have power while the measuring point does not, or the other way round. An outage limited to another street or extension will not appear.

**What it measures.** Every interruption to the supply at the measuring point, planned or unplanned, whatever the cause. It is not a load-shedding schedule and does not predict outages. The statistics describe outages recorded at that one point; they are not a statement about any organisation's performance.

- **Status**: whether the power is on or off at the measuring point, as last recorded, and for how long. The browser tab title and favicon follow the status.
- **Statistics**: hours without power, number of outages, days with an outage and the longest outage over the last 30 days, compared with the previous 30 days once enough data exists, with a weekly chart and table. Only time since records began is counted.
- **Planned outages**: outages announced in advance (for example maintenance or upgrades) are tagged as planned. They still count as time without power.
- **Community confirmations**: during an outage, the "My power is off too" button records one confirmation per connection per outage, protected by Cloudflare Turnstile.
- **"Still off" reports**: while the status is on, residents whose power is still off (for example on a back-fed street) can say so, once per connection every 2 hours. The count of the last hour is shown. Reports never change the status.
- **Open data**: every outage as CSV, an Atom feed and a public JSON API.

**Languages.** The site is in Afrikaans at `/` and in English at `/en/`. The language switch moves between the two and remembers the choice, so a visitor who chose English and opens `/` goes on to `/en/`. The API and `llms.txt` are in English.

## Using the data

The CSV, the feed and the public API are free to use. The outage data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (`site.dataLicence`): credit "Lights On, Garsfontein?" and link to the site. It is provided as is, with no warranty of accuracy. The code is MIT. Times are UTC (ISO 8601); local time for this deployment is SAST (UTC+2, no daylight saving). Please poll no more than once every 30 seconds.

| Method and path | Purpose | Caching | Limits and access |
| --- | --- | --- | --- |
| `GET /api/status` | `status` (`ON`/`OFF`), `since`, the open `outage`, the five most `recent` outages, `monitored`, `stillOffReports`, `generatedAt` | `no-store` for browsers; 12 s at the edge, cleared on writes | Shared 60/min; CORS |
| `GET /api/stats` | Last 7, 30 and 365 days, the previous 30 days (once tracked), up to 26 weekly totals | `max-age=60`; cleared at the edge on writes | Shared 60/min; CORS |
| `GET /api/outages.csv` | Every outage, false positives excluded | `max-age=300`; cleared at the edge on writes | Shared 60/min; CORS |
| `GET /feed.xml` | Atom feed of the 20 most recent outages, false positives excluded | `max-age=300`; cleared at the edge on writes | Shared 60/min; CORS |
| `GET /og.png` | Social card: a single status-neutral image that never claims on or off | `max-age=60` | None |
| `GET /sitemap.xml`, `/robots.txt` | Search engine files | `max-age=3600` | None |
| `POST /api/confirm` | Community confirmation: once per connection per outage | `no-store` | 5/min; same-origin; Turnstile |
| `POST /api/still-off` | "Still off" report while the status is `ON`: once per connection every 2 hours. Never changes the status | `no-store` | 5/min, shared with `/api/confirm`; same-origin; Turnstile (action `still_off`) |
| `POST /api/heartbeat` | Sensor check-in | `no-store` | `HEARTBEAT_TOKEN` |
| `POST /api/admin/login`, `/logout` | Sets or clears the admin session cookie | `no-store` | Same-origin. Login: Turnstile, 5/min per connection and 30/min site-wide |
| `GET`/`POST /api/admin/outages`, `POST /api/admin/timer` | Manage outages and the punch clock | `no-store` | Session or `ADMIN_API_TOKEN` |

"Shared 60/min" is one limit across those endpoints, per connection, with IPv6 addresses counted per /64. Over a limit, the API answers `429` with `Retry-After: 60`. The edge cache is per Cloudflare datacentre, so a write clears only the copy in the datacentre that handled it; elsewhere the short TTL bounds the delay.

### Status fields

- `monitored` is `true` while the sensor at the measuring point is reporting (its last heartbeat is fresh). When it is `false`, `ON` only means that no outage has been reported, not that power was measured.
- `stillOffReports` is the number of "still off" reports in the last hour while the status is `ON`, and always `0` while it is `OFF`.
- `confirmations` and `stillOffReports` are counts from residents, not measurements. They never change `status`.

`POST /api/still-off` takes `{ "token": "<Turnstile token for the still_off action>" }` and answers `201` with `{ "reports": n }`, or `409` with `outage_in_progress` (use `/api/confirm` instead) or `already_reported` (within the last 2 hours).

### CSV contract

`GET /api/outages.csv` downloads as `<slug>-outages.csv` (here, `lights-on-garsfontein-outages.csv`), one row per outage, oldest first:

```csv
id,start_time_utc,end_time_utc,duration_minutes,planned,confirmations
```

- `start_time_utc` and `end_time_utc` are ISO 8601 UTC.
- `end_time_utc` and `duration_minutes` (whole minutes) are empty while an outage is open.
- `planned` is `yes` or `no`; `confirmations` counts community confirmations.
- Outages marked as false positives are excluded. Any origin may read it (CORS).

This is a stable contract. Columns are never renamed, reordered or reformatted; new columns are only appended at the end, and any change comes with a version note in this README.

### llms.txt

A plain-text summary for language models is served at [`/llms.txt`](https://garsfontein.timothybrits.co.za/llms.txt). It is built from `templates/llms.txt`.

## Recording outages

Outages are recorded by a heartbeat sensor, by hand on the admin page, or both. The public site and API never say how an outage was recorded; only the admin API exposes the `source` field.

**Admin page.** Sign in at `/admin`. The session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`; it lasts 30 days after the last visit and never more than 90 days after sign-in. Tap **Punch out** when the power goes off and **Punch in** when it is restored. **Log a past outage** adds anything missed. Each outage can be marked **Planned** or **False positive**, closed or deleted. With no open outage and no sensor reporting, the status is on.

Outages from before the start date can be added for the history and CSV, but statistics only count time from `trackingSince` in `site.config.ts`, so untracked days never improve the figures.

**Scripts and AI agents.** Admin endpoints also accept `Authorization: Bearer <ADMIN_API_TOKEN>`. Wrong tokens count towards the sign-in rate limit. Times must include an offset and may be at most five minutes in the future. Keep the URL and token in a git-ignored `.env`.

```sh
# The power went off (use "punch_in" when it is restored)
curl -X POST "$SITE_URL/api/admin/timer" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"punch_out"}'

# Log an outage after the fact (include the offset; SAST is +02:00)
curl -X POST "$SITE_URL/api/admin/outages" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"create","startTime":"2026-10-17T05:52:00+02:00","endTime":"2026-10-17T11:15:00+02:00","isPlanned":false}'

# List the 50 most recent outages, then correct one by id ("delete" takes only an id)
curl "$SITE_URL/api/admin/outages" -H "Authorization: Bearer $ADMIN_API_TOKEN"
curl -X POST "$SITE_URL/api/admin/outages" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"update","id":3,"endTime":"2026-10-17T11:20:00+02:00"}'
```

`update` also accepts `isPlanned` and `isFalsePositive`; marking an open outage as a false positive closes it. To rotate the token, generate a new one, run `npx wrangler secret put ADMIN_API_TOKEN` and update `.env`.

**Heartbeat sensor.** An always-on device sends a heartbeat every minute. After three minutes without one, the minute cron opens an outage starting at the last heartbeat, and the next heartbeat closes it. Heartbeats only close outages the sensor opened, so the punch clock works alongside a sensor. Heartbeats are refused until `HEARTBEAT_TOKEN` is set (`npx wrangler secret put HEARTBEAT_TOKEN`).

Each instance supports one sensor: `worker/db/schema.ts` keeps a single heartbeat row. A second sensor would need its own rows, a sensor id on the heartbeat route and on sensor outages, and its own detection.

Hardware:

- An ESP32 in an enclosure, such as an M5Stack Atom, powered by a USB charger.
- Plug it into a socket on the grid, not one behind an inverter, UPS or backup supply, or it will never see an outage.
- The ESP32 needs 2.4 GHz Wi-Fi. Ideally put the router on backup power, so the sensor goes quiet only when the grid does.
- If the internet connection drops while the power stays on, the sensor goes quiet and an outage is logged; mark it as a false positive.

ESP32 sketch (Arduino IDE with ESP32 Arduino core 3.3 or later). It verifies the server's certificate against the root certificates built into the core:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
const char* TOKEN     = "YOUR_TOKEN";
const char* URL       = "https://YOUR_DOMAIN/api/heartbeat";

void setup() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.useBuiltinCACertBundle();  // verify the server against the core's root CA bundle
    HTTPClient http;
    http.begin(client, URL);
    http.addHeader("Authorization", String("Bearer ") + TOKEN);
    http.POST("");
    http.end();
  } else {
    WiFi.reconnect();
  }
  delay(60 * 1000);
}
```

A Raspberry Pi, or an old Android phone with Termux, works too (crontab):

```cron
* * * * * curl -fsS -m 20 -X POST -H "Authorization: Bearer YOUR_TOKEN" https://YOUR_DOMAIN/api/heartbeat >/dev/null
```

## Run it for your area

You need Node 24, a Cloudflare account and, optionally, a domain on Cloudflare.

1. **Fork and clone** the repository, then run `npm install`.
2. **Edit `site.config.ts`**, the deployment's identity:

   | Field | Meaning |
   | --- | --- |
   | `slug` | Used in file names, such as the CSV download |
   | `url` | The public origin, no trailing slash; must equal `SITE_URL` in `wrangler.toml` |
   | `repo` | Source code link, shown in the privacy notice and `llms.txt` |
   | `brand.short`, `brand.full` | Short and full site names |
   | `operator.name` | The operator: the responsible party in the privacy notice, and the provider in structured data |
   | `landmark` | A place near the measuring point that residents recognise, never the exact address |
   | `faultReporting.url` | The utility's official page for reporting faults (the link text is in the dictionaries). Check that the link still works |
   | `dataLicence.name`, `dataLicence.url` | Licence for the outage data (CSV, feed and API), shown in the terms and `llms.txt`. The code stays MIT |
   | `area` | Name, region, city, province and country, for structured data (JSON-LD) only |
   | `trackingSince` | When records begin, with offset; nothing before it counts as tracked time |
   | `timeZone` | IANA zone for every displayed date and time |
   | `utcOffsetMinutes` | The zone's fixed UTC offset, for day and week boundaries and the admin time inputs. Daylight saving is not supported |
   | `locales` | Languages; the first is the default, and a single entry hides the switch |
   | `intlLocales` | BCP 47 tag per locale, for `Intl` formatting |

3. **Edit the place copy** in `src/i18n/*.ts` (for example `masthead`, `footer.measured` and `footer.operator`). `af.ts` is the source of truth; every dictionary must match its shape. `src/i18n/head.ts` holds each language page's title, description and link-preview copy.
4. **Review the localised prose** in `index.html`, `privacy.html` and `templates/` (`llms.txt`, `site.webmanifest`) that still names the area, substation or operator. Values from the config go in as `%site.<path>%` (for example `%site.brand.full%`) and the start date as `%since.<locale>%`. The build fails on an unknown or leftover placeholder.
5. **Configure Cloudflare.**
   1. `cp wrangler.example.toml wrangler.toml` and choose a Worker `name` and `database_name`.
   2. `npx wrangler d1 create <database_name>` and paste the printed `database_id`.
   3. Create a Turnstile widget in the Cloudflare dashboard. Add every hostname the site is served from (your custom domain, `<name>.<account>.workers.dev`, and `localhost`), and set `TURNSTILE_SITE_KEY` to its site key.
   4. Set `SITE_URL` to exactly the same value as `site.url`.
   5. Each rate limiter's `namespace_id` must be unique in your account; change them if another Worker already uses them.
   6. Either keep `workers_dev = true`, or uncomment `routes` for a custom domain and set `workers_dev = false` once it is live. Cloudflare creates the DNS record and certificate on deploy.
6. **Set the secrets** with `npx wrangler login`, then `npx wrangler secret put <NAME>`:

   | Secret | Purpose |
   | --- | --- |
   | `ADMIN_USERNAME` | Admin sign-in name (case-insensitive) |
   | `ADMIN_PASSWORD_HASH` | PBKDF2 hash of the admin password: `npm run --silent hash-password \| npx wrangler secret put ADMIN_PASSWORD_HASH` (input hidden, at least 12 characters) |
   | `TURNSTILE_SECRET_KEY` | The Turnstile widget's secret key |
   | `IP_SALT` | Salt for the hashed connection fingerprints on confirmations and "still off" reports. A long random string; never change it |
   | `ADMIN_API_TOKEN` | Optional: bearer token for scripts and agents |
   | `HEARTBEAT_TOKEN` | Optional: bearer token for the sensor |
   | `CONTACT_EMAIL` | Optional: the email address for privacy requests. The privacy page reveals it only after a Turnstile check (`POST /api/contact`), so it never appears in the repo or the built site. Until it is set, requests go to GitHub issues, which are public |

   For random values, use for example `openssl rand -base64 32`. Changing `ADMIN_PASSWORD_HASH` signs out every session on its next use, as each session stores a short fingerprint of the hash.
7. **Apply the migrations and deploy.** Manually: `npm run deploy` (build, apply pending migrations, deploy). With Cloudflare Workers Builds, connect the repository and use `npm run deploy:ci` as the deploy command; it applies pending D1 migrations first and only then deploys, so if a migration fails the previous version stays live. Pull requests are tested by GitHub Actions and are not deployed.
8. **Regenerate the images**: `npm run og` for the social card (one status-neutral image; brand and labels come from the config and dictionaries) and `npm run icons` for the app icons (both need `npx playwright install chromium` once). Edit the `<title>` in `public/favicon.svg` by hand.
9. **Review `privacy.html`** for your jurisdiction. It holds the privacy notice and the terms of use, is written for POPIA (South Africa) and describes this deployment's data handling, including Cloudflare's log retention on this plan. The `FORKERS` comments mark what to check.

   Do not use utility or municipal logos or branding, and keep the independence disclaimer (masthead, footer, privacy page and `llms.txt`).
10. **Banners.** `src/banners.ts` holds short, dated notices shown at the bottom of the public page. To add one, append an entry to `BANNERS` with a new, stable `id` (dismissals are remembered by it), `from` and `until` via `zoned('YYYY-MM-DDTHH:mm')` in the configured zone (`until` is exclusive), and the copy (required in the default locale, optional in others). To remove one, delete its entry; expired entries stop rendering on their own. At most one banner shows at a time.

Two cron triggers run the Worker (`crons = ["* * * * *", "0 * * * *"]`). Every minute it checks for a silent sensor and opens an outage. Every hour it removes expired sessions, clears the hashed connection fingerprints from confirmations and "still off" reports older than 30 days (the confirmation counts are kept), and deletes "still off" reports older than 90 days.

## Extending

| Path | Contents |
| --- | --- |
| `src/` | SolidJS app: `components/`, `admin/`, `i18n/` dictionaries, `lib/` (API client, formatting, locale, zone), `styles/`, `banners.ts` |
| `worker/` | Cloudflare Worker: `index.ts` (route table, security headers, crons), `routes/`, `lib/` (router, auth, grid state, stats), `db/` (Drizzle schema) |
| `shared/` | `api.ts`: response types and constants shared by the Worker and the app |
| `site.config.ts` | The deployment's identity, read by the app, Worker, build and scripts |
| `templates/` | `llms.txt` and `site.webmanifest`, filled and emitted at build time |
| `drizzle/` | SQL migrations, generated by drizzle-kit |
| `build/` | String helpers for the plugins in `vite.config.ts`: placeholders and the static shell copy |
| `scripts/` | Password hashing, OG card and icon rendering, the service worker kill switch |
| `test/`, `e2e/` | Vitest tests (the Worker, and in `test/node/` the app, build and built site) and Playwright browser tests |

**Adding an endpoint.**

1. Write the handler and its route map in a file under `worker/routes/`, keyed by `"METHOD /path"`.
2. Spread the route map into `routes` in `worker/index.ts`.
3. Add any path outside `/api/` to `assets.run_worker_first` in `wrangler.toml` (and `wrangler.example.toml`).
4. Add the path to `server.proxy` in `vite.config.ts`, so `npm run dev` reaches it.
5. Declare guards on the route rather than in the handler (`worker/lib/router.ts`): `sameOrigin` (cookie-authenticated writes), `limiter`, `authorize`, `cors` (open data), `edgeCache` and `purges` (edge-cached paths the write changes).

**Adding a language.**

1. Add the code to `site.locales` and its BCP 47 tag to `intlLocales` in `site.config.ts`.
2. Create `src/i18n/<code>.ts` exporting a dictionary that `satisfies Messages`.
3. Register it in `DICTIONARIES` in `src/i18n/index.ts`.
4. In each dictionary, `lang.switchTo` labels the switch to the next locale in `site.locales`, written in that next language.
5. Banner copy is optional except in the default locale.
6. Add the language's `<head>` copy to `src/i18n/head.ts`. The build writes its page to `dist/<code>/index.html`, served at `/<code>/`, with its own canonical URL and hreflang links, and the sitemap lists it.
7. Add a section for the language to `privacy.html`, with a link at the top.

To run in a single language, set `site.locales` to one entry; the language switch is then hidden.

**Adding an outage source.** Extend the `source` enum in `worker/db/schema.ts`, `OutageSource` in `shared/api.ts` and the admin `source` labels in the dictionaries together, then run `npm run db:generate` and commit any migration. Public responses must still not reveal the source.

**Writing migrations.** The database changes a few seconds before the code does, so every migration must work with both the old and the new code:

- Add before you use: add a column or table in one release, start using it in the next.
- Remove after you stop using: stop reading a column in one release, drop it in a later one.
- Give new columns a default (or make them nullable) so the old code can still insert rows.
- Never rename in place. Add the new name, copy the data, switch the code over, then drop the old name.
- Check what drizzle-kit generates. On SQLite it sometimes rebuilds a whole table, and on D1 that can cascade-delete related rows (see `drizzle/0003_boolean_flags.sql`).

**Testing.** `npm test` runs two Vitest projects: the Worker tests (`test/*.test.ts`) inside workerd (`@cloudflare/vitest-plugin`), against a D1 database with the migrations applied, and in Node (`test/node/`) the app's pure logic, the build helpers in `build/html.ts`, and checks on the built site that run once `dist/` exists. Playwright tests build the site and run against a fresh local Worker and database; each test starts with no outages (`e2e/fixtures.ts`). That Worker runs as `wrangler dev --env e2e`: the `e2e` environment in `wrangler.toml` (and `wrangler.example.toml`) repeats the bindings with rate limits that suit a test suite, and only the confirmation test still runs into one. CI (GitHub Actions) needs no secrets: it uses `.dev.vars.example`, and checks that the generated Worker types and Drizzle migrations do not drift from their sources, then lints, type-checks, builds and runs both suites.

**The CSP hash rule.** The pages' CSP allows inline scripts only by hash. `index.html` and `privacy.html` each have one inline boot script (theme, and on `index.html` also the language), whose SHA-256 is listed in `public/_headers`; `test/csp.test.ts` checks the hashes, and `test/node/dist.test.ts` checks them in the built pages. Keep the boot scripts' text static, with no placeholders (the page's language and the locale list reach the script through `<html lang>` and `<html data-locales>`), and update the hash in `public/_headers` whenever you change one.

**Offline support.** A service worker (`src/sw/sw.ts`, built to `dist/sw.js` by the `serviceWorker` plugin in `vite.config.ts`) keeps the pages and the last status available without a connection. `src/index.tsx` registers it after the page has loaded, in production builds only. It handles only same-origin GET requests, and only these (`src/sw/strategy.ts`, tested in `test/sw.test.ts`):

| Request | Strategy |
| --- | --- |
| `/`, `/en/`, `/privacy` | Network first; after 3 seconds or on a network failure, this build's precached copy. Never stored at runtime, so a copy always matches the assets cached with it. |
| `/assets/*` | From the precache, else the network; nothing is stored at runtime. |
| `/api/status` | Network first; after 3 seconds, on a failure or on an error reply (5xx, 429), the last good status from the `status` cache, marked `X-From-Cache: 1`. The page then shows "No connection · status as at HH:MM" (with the day when it is not today's; the time is when the server produced it) until a fresh status arrives. The `status` cache is not tied to a build, so a deploy keeps it. |
| Everything else | Not handled: every write, `/admin`, the rest of the API (`/api/admin/*`, `/api/still-off`, `/api/confirm`, `/api/contact`, `/api/stats`, `/api/outages.csv`), `/feed.xml`, `/og.png`, `/cdn-cgi/*` and other origins such as Turnstile go to the network as if there were no worker. |

Each build precaches its pages and every asset into a cache named after a hash of those files and of `src/sw/`. A deploy therefore changes `sw.js`, which browsers check on every navigation (`public/_headers` serves it with `Cache-Control: no-cache`). The new worker installs in the background, and the install fails, to be tried again at the next navigation, if a precached page is redirected or references an asset the build does not have (a deploy that landed mid-install). Then it takes over at once and deletes the older build caches. Open pages carry on: their pages are network first, and if one needs a lazy chunk the server no longer has, it reloads onto the current build (`vite:preloadError` in `src/index.tsx`).

**If the service worker misbehaves**, replace it with `scripts/sw-kill-switch.js`, which deletes the site's caches and unregisters itself. Browsers pick it up at their next visit, and open pages are back to normal at their next reload.

1. If the fault may last more than a day, first remove the registration from `src/index.tsx`, so that browsers stop installing a worker at all.
2. Deploy the kill switch in place of the built worker:

   ```sh
   npm run build
   cp scripts/sw-kill-switch.js dist/sw.js
   npm run deploy:ci   # not "npm run deploy", which would build sw.js again
   ```

3. Until the fault is fixed, deploy this way every time: any deploy without step 2 puts the worker back.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # local test keys; sign in as "admin" / "test-password"
npm run db:migrate:local
npm run preview                  # build, then serve on http://localhost:8787
```

For hot reload, run `npm run dev:worker` and `npm run dev` side by side. Vite serves the UI on port 5173 and proxies API calls to the Worker. Run `npm run build` once first: the Worker serves its static assets from `./dist` and will not start without it.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run dev:worker` | Vite dev server / local Worker |
| `npm run build` / `npm run preview` | Build to `./dist` / build and serve the Worker locally |
| `npm test` / `npm run test:watch` | Worker, app and build tests, once or in watch mode |
| `npm run test:e2e` | Browser tests against a fresh local Worker and database |
| `npm run lint` / `npm run lint:fix` | Lint and format with Biome |
| `npm run lint:ci` | Lint and format check without writing changes, as CI runs it |
| `npm run typecheck` | Type-check the app, Worker, tests and scripts |
| `npm run cf-typegen` | Regenerate `worker/worker-configuration.d.ts` after changing `wrangler.toml` |
| `npm run db:generate` | Create a migration after changing `worker/db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply pending migrations locally / to the production database |
| `npm run hash-password` | Print an `ADMIN_PASSWORD_HASH` value (input hidden) |
| `npm run og` / `npm run icons` | Re-render the social card and app icons |
| `npm run deploy` / `deploy:ci` | Build, migrate and deploy / migrate and deploy |

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/mooship/lights-on-garsfontein). Please open an issue before starting on a larger change.

- Lefthook runs Biome and the type check on commit, and the unit tests on push. CI also runs the end-to-end tests. Before opening a pull request, run `npm run lint:ci`, `npm run typecheck`, `npm test` and `npm run test:e2e`.
- User-facing text lives in `src/i18n/af.ts` (the source and default) and `src/i18n/en.ts`; add every new string to both.

By contributing, you agree that your contributions are licensed under the MIT licence.

## Licence and credits

[MIT](LICENSE).

| Layer | Tools |
| --- | --- |
| Front end | SolidJS, Vite, Vanilla Extract, Lucide icons |
| Back end | Cloudflare Workers (static assets and API), D1 with Drizzle ORM, Zod |
| Security | Cloudflare Turnstile, Workers rate limiting, PBKDF2 password hashing, strict CSP |
| Quality | Vitest in the Workers runtime, Playwright, Biome, Lefthook, GitHub Actions, Dependabot |

Fonts: Fraunces and Plus Jakarta Sans (SIL Open Font License), via Fontsource. Icons: Lucide (ISC).
