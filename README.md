# Lights On, Garsfontein?

[![CI](https://github.com/mooship/lights-on-garsfontein/actions/workflows/ci.yml/badge.svg)](https://github.com/mooship/lights-on-garsfontein/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Shows whether the electricity supply is on in Garsfontein, Pretoria, and keeps an open record of every outage since **17 October 2026**.

**Live at https://garsfontein.timothybrits.co.za** (Afrikaans at `/`, English at `/en/`).

- **Where it is measured.** At one home in Garsfontein Extension 16 (Ward 45, Region 6, City of Tshwane), near Mediclinic Denmar. The area is normally supplied by the Garsfontein substation (fed from Highlands, which is fed from Njala) and usually goes off as a whole.
- **Its limits.** It is one measuring point, so some streets can differ: parts of the network can be back-fed from another substation, and an outage limited to another street or extension will not appear. It records every interruption, planned or not; it is not a load-shedding schedule and does not predict outages.
- **Independent.** Operated by a resident of Garsfontein Extension 16. Not affiliated with, endorsed by or speaking for the City of Tshwane or Eskom.

The site shows the status as last recorded and for how long, statistics for the last 30 days (compared with the 30 before, once tracked) with a weekly chart, and recent outages, with planned outages tagged. Without a reporting sensor, the status reads "No outage reported" rather than claiming the power is on.

The code runs on one Cloudflare Worker with a D1 database, and anyone can run it for their own area.

## Using the data

The outage data (API, CSV and feed) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): credit "Lights On, Garsfontein?" and link to the site. It is provided as is, with no warranty of accuracy. Times are ISO 8601 UTC; local time is SAST (UTC+2, no daylight saving). Please poll no more than once every 30 seconds. A plain-text summary for language models is at [`/llms.txt`](https://garsfontein.timothybrits.co.za/llms.txt).

### API

| Method and path | Returns | Caching | Limits and access |
| --- | --- | --- | --- |
| `GET /api/status` | `status` (`ON`/`OFF`), `since`, the open `outage`, the five most `recent` outages, `monitored`, `turnstileSiteKey`, `generatedAt` | `no-store` for browsers; 12 s at the edge | Shared 60/min; CORS |
| `GET /api/stats` | The last 7, 30 and 365 days, the previous 30 days (`null` until tracked), up to 26 weekly totals | `max-age=60` | Shared 60/min; CORS |
| `GET /api/outages.csv` | Every outage, false positives excluded | `max-age=300` | Shared 60/min; CORS |
| `GET /feed.xml` | Atom feed of the 20 most recent outages, false positives excluded | `max-age=300` | Shared 60/min; CORS |
| `GET /og.png` | Social card; status-neutral | `max-age=60` | None |
| `GET /sitemap.xml`, `/robots.txt` | Search engine files | `max-age=3600` | None |
| `POST /api/contact` | The privacy contact address | `no-store` | 5/min; Turnstile |
| `POST /api/heartbeat` | Sensor check-in | `no-store` | `HEARTBEAT_TOKEN` |
| `POST /api/heartbeat/pause` | Pauses outage detection | `no-store` | `HEARTBEAT_TOKEN` |
| `POST /api/admin/login`, `/logout` | Sets or clears the admin session cookie | `no-store` | Login: Turnstile, 5/min per connection and 30/min site-wide |
| `GET`/`POST /api/admin/outages`, `POST /api/admin/timer` | Manage outages and the punch clock | `no-store` | Session or `ADMIN_API_TOKEN` |

- "Shared 60/min" is one limit per connection across those four endpoints; `POST /api/contact` has its own 5/min. IPv6 addresses are counted per /64. Over a limit the API answers `429` with `Retry-After: 60`.
- A `POST` without a bearer token must come from the site itself and carry a JSON body: other sites get `403`, other bodies `415`. Bearer requests (scripts, the sensor) are exempt.
- Every `GET` route also answers `HEAD`, but the edge cache holds `GET` responses only. It is per Cloudflare datacentre. Writes clear it only in the datacentre that handled them; elsewhere the TTL bounds the delay.
- `monitored` is `true` while the sensor's last heartbeat is fresh and it is not paused. When it is `false`, `ON` means only that no outage has been reported.
- Only the admin API exposes an outage's `source`.
- `POST /api/contact` takes `{ "token" }`, a Turnstile token solved for the `contact` action, and answers `200` with `{ "email" }`, or `404` with `not_configured`.

### CSV contract

`GET /api/outages.csv` downloads as `<slug>-outages.csv` (here `lights-on-garsfontein-outages.csv`), one row per outage, oldest first:

```csv
id,start_time_utc,end_time_utc,duration_minutes,planned
```

- `start_time_utc` and `end_time_utc` are ISO 8601 UTC; `end_time_utc` and `duration_minutes` (whole minutes) are empty while an outage is open.
- `planned` is `yes` or `no`.

Columns are never renamed, reordered or reformatted. New columns are only appended, with a note under "Contract changes".

### Contract changes

- 18 October 2026: community confirmations and "still off" reports were removed, with `POST /api/confirm`, `POST /api/still-off`, the `confirmations` field on each outage and CSV column, and `stillOffReports` in the status. Every recorded `confirmations` value was 0.

## Recording outages

Outages come from a heartbeat sensor, the admin punch clock, or both.

### Admin

Sign in at `/admin`. The session cookie (`__Host-admin_session`, `HttpOnly`, `Secure`, `SameSite=Strict`) lasts 30 days after the last visit and never more than 90 days after sign-in. **Punch out** when the power goes off and **Punch in** when it returns; **Log a past outage** adds anything missed. Each outage can be marked **Planned** or **False positive**, closed or deleted. Outages before `trackingSince` can be added for the history and CSV, but statistics count only time from then.

Scripts can use `Authorization: Bearer <ADMIN_API_TOKEN>` instead of a session; wrong tokens count towards the per-connection sign-in limit. Times need an offset and may be at most five minutes in the future.

```sh
# The power went off ("punch_in" when it returns)
curl -X POST "$SITE_URL/api/admin/timer" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"punch_out"}'

# Log a past outage (omit endTime to leave it open)
curl -X POST "$SITE_URL/api/admin/outages" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"create","startTime":"2026-10-17T05:52:00+02:00","endTime":"2026-10-17T11:15:00+02:00","isPlanned":false}'

# List the 50 most recent, then correct one by id
curl "$SITE_URL/api/admin/outages" -H "Authorization: Bearer $ADMIN_API_TOKEN"
curl -X POST "$SITE_URL/api/admin/outages" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"update","id":3,"endTime":"2026-10-17T11:20:00+02:00"}'
```

`update` also accepts `isPlanned` and `isFalsePositive` (marking an open outage as a false positive closes it); `delete` takes only an `id`. Keep the URL and token in a git-ignored `.env` (copy `.env.example`).

### Sensor

An always-on device posts to `/api/heartbeat` every minute. Once the last heartbeat is more than three minutes old, the status shows `OFF` and the minute cron opens an outage starting at that heartbeat. The next heartbeat closes **every** open outage, punch-clock ones included, since the sensor seeing power means the power is on; if power returned between two cron runs, the gap is still recorded. Heartbeats are refused until `HEARTBEAT_TOKEN` is set. Each instance supports one sensor (`worker/db/schema.ts` keeps a single heartbeat row).

A sensor that will be away from its usual supply can pause detection: `POST /api/heartbeat/pause` with `{ "until": "<ISO time with offset>" }`, at most 30 days ahead. Until then no outage opens and `monitored` is `false`, so the status reads only that no outage has been reported; the punch clock still works. Afterwards the silence counts from the pause's end, not the last heartbeat. `{ "until": null }` ends a pause now. The answer is `{ "ok": true, "pausedUntil" }`, with `null` when nothing is paused.

Hardware tips:

- An ESP32 in an enclosure, such as an M5Stack Atom, on a USB charger.
- Plug it into a socket on the grid, not one behind an inverter, UPS or backup supply, or it will never see an outage.
- The ESP32 needs 2.4 GHz Wi-Fi. Put the router on backup power if you can, so the sensor goes quiet only when the grid does.
- If the internet drops while the power stays on, an outage is logged; mark it as a false positive.

ESP32 sketch (Arduino IDE, ESP32 Arduino core 3.3 or later), verifying the server against the core's built-in root certificates:

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
    client.useBuiltinCACertBundle();
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

A Raspberry Pi, or an old Android phone with Termux, works too:

```cron
* * * * * curl -fsS -m 20 -X POST -H "Authorization: Bearer YOUR_TOKEN" https://YOUR_DOMAIN/api/heartbeat >/dev/null
```

A MacBook that stays on its charger works without extra hardware. It posts only while drawing from AC power, so when it falls back to its battery the heartbeats stop and an outage opens, even if the router is on backup power. On the Mac, without cloning:

```sh
curl -fsSL -o /tmp/lights-on.sh https://raw.githubusercontent.com/mooship/lights-on-garsfontein/main/scripts/mac-sensor.sh && sh /tmp/lights-on.sh install https://YOUR_DOMAIN YOUR_TOKEN
```

This keeps the token in the login keychain (leave it off to be asked for it instead, which keeps it out of your shell history), starts a launch agent that keeps the Mac awake only while it is on the charger, and adds a `lights-on` command:

| Command | Does |
| --- | --- |
| `lights-on pause 3h` | Stops reporting for `30m`, `3h`, `2d` and so on, without logging an outage. Use it before you leave with the Mac or charge it somewhere else |
| `lights-on resume` | Reports again now |
| `lights-on status` | Shows whether it is reporting, paused or on battery, and the last logged error |
| `lights-on uninstall` | Removes the agent, the command and the token |

Keep the lid open, since closing it sleeps the Mac and logs a false outage. The agent runs only while you are logged in, so after a restart, log in again. Errors go to `~/Library/Logs/lights-on-heartbeat.log`.

## Run it for your area

You need Node 24, a Cloudflare account and, optionally, a domain on Cloudflare.

1. **Fork and clone**, then `npm install`.
2. **Edit `site.config.ts`**, the deployment's identity:

   | Field | Meaning |
   | --- | --- |
   | `slug` | Used in file names, such as the CSV download |
   | `url` | Public origin, no trailing slash; must equal `SITE_URL` in `wrangler.toml` |
   | `repo` | Source link, shown in the privacy notice and `llms.txt` |
   | `brand.short`, `brand.full` | Short and full site names |
   | `operator.name` | Responsible party in the privacy notice; provider in structured data |
   | `landmark` | A place near the measuring point that residents recognise, never the exact address |
   | `faultReporting.url` | The utility's official fault-reporting page; check it still works |
   | `dataLicence.name`, `.url` | Licence for the outage data; the code stays MIT |
   | `area` | Name, region, city, province and country, for structured data only |
   | `trackingSince` | When records begin, with offset |
   | `timeZone` | IANA zone for displayed dates and times |
   | `utcOffsetMinutes` | Fixed UTC offset for day and week boundaries; daylight saving is not supported |
   | `locales` | Languages; the first is the default, and one entry hides the switch |
   | `intlLocales` | BCP 47 tag per locale, for `Intl` formatting |

3. **Edit the place copy** in `src/i18n/*.ts` (for example `masthead`, `footer.measured`, `footer.operator` and `scope`) and the `<head>` copy in `src/i18n/head.ts`.
4. **Review the prose** in `index.html`, `privacy.html` and `templates/` (`llms.txt`, `site.webmanifest`) that names the area or operator. Config values go in as `%site.<path>%` and the start date as `%since.<locale>%`; the build fails on an unknown placeholder.
5. **Configure Cloudflare**: `cp wrangler.example.toml wrangler.toml` and follow the numbered steps at its top (Worker and database names, `npx wrangler d1 create`, Turnstile widget and hostnames, `SITE_URL`). Each rate limiter's `namespace_id` must be unique in your account. Keep `workers_dev = true`, or uncomment `routes` for a custom domain and set `workers_dev = false` once it is live.
6. **Set the secrets** (`npx wrangler login`, then `npx wrangler secret put <NAME>`):

   | Secret | Purpose |
   | --- | --- |
   | `ADMIN_USERNAME` | Admin sign-in name (case-insensitive) |
   | `ADMIN_PASSWORD_HASH` | PBKDF2 hash of a password of at least 12 characters: `npm run --silent hash-password \| npx wrangler secret put ADMIN_PASSWORD_HASH`. Changing it signs out every session |
   | `TURNSTILE_SECRET_KEY` | The Turnstile widget's secret key |
   | `ADMIN_API_TOKEN` | Optional: bearer token for scripts |
   | `HEARTBEAT_TOKEN` | Optional: bearer token for the sensor |
   | `CONTACT_EMAIL` | Optional: address for privacy requests, revealed on the privacy page only after a Turnstile check. Until it is set, requests go to public GitHub issues |

   For random values, use for example `openssl rand -base64 32`.
7. **Deploy.** `npm run deploy` builds, applies pending D1 migrations and deploys. With Cloudflare Workers Builds, use `npm run build` as the build command and `npm run deploy:ci` as the deploy command: migrations run first, so if one fails the previous version stays live.
8. **Regenerate the images**: `npm run og` (social card) and `npm run icons` (both need `npx playwright install chromium` once). Edit the `<title>` in `public/favicon.svg` by hand. The colours come from `src/styles/palette.ts`; files that cannot import it keep copies to change with it: `src/styles/privacy.css`, the theme-color metas in `index.html`, `public/favicon*.svg`, and `background_color` and `theme_color` in `templates/site.webmanifest` (JSON, so it cannot carry a note).
9. **Review `privacy.html`** for your jurisdiction. It holds the privacy notice and terms, is written for POPIA and describes this deployment's data handling; `FORKERS` comments mark what to check. Do not use utility or municipal logos, and keep the independence disclaimer.

Two crons run the Worker. Every minute it opens an outage for a silent sensor. Every hour it removes expired sessions.

## Extending

| Path | Contents |
| --- | --- |
| `site.config.ts` | Deployment identity (see [Run it for your area](#run-it-for-your-area)) |
| `src/` | SolidJS app: `components/`, `lib/`, `styles/` (colours in `palette.ts`), `sw/` (service worker), `banners.ts` |
| `src/i18n/` | Public copy: one dictionary per language (`af.ts` is the source) and `head.ts` for the `<head>` |
| `src/admin/` | The `/admin` page; its copy is English-only, in `copy.ts`, outside the dictionaries |
| `worker/` | Worker: `index.ts` (security headers, crons), `routes/` (handlers; the route table is in `routes/index.ts`), `lib/` (router, grid, stats, auth, Turnstile), `crons.ts`, `db/schema.ts` |
| `shared/` | Types and constants for both the app and the Worker: `api.ts` (API types, `OUTAGE_SOURCES`, `UTC_OFFSET_MS`, `localDate`), `paths.ts`, `errors.ts`, `locale.ts` (`LOCALES`, `DEFAULT_LOCALE`, `pageLocale`) |
| `build/`, `vite.config.ts` | Build plugins: placeholders, static shell, locale pages and CSS, font preload, service worker |
| `index.html`, `privacy.html`, `templates/` | Static pages, `llms.txt` and `site.webmanifest`, filled from `site.config.ts` at build time |
| `drizzle/`, `scripts/` | Generated SQL migrations; password hashing, OG card and icon rendering, the service worker kill switch, the MacBook sensor |
| `test/`, `test/node/`, `e2e/`, `bruno/` | Vitest (the Worker in workerd with D1; Node for pure logic and the build), Playwright, the Bruno API collection |

**Adding an endpoint.** Add its path to `shared/paths.ts`, put the handler and its route map (keyed by `"METHOD /path"`) in `worker/routes/`, and spread it into `routes` in `worker/routes/index.ts`. A path outside `/api/` also goes in `WORKER_PAGES` (which the dev proxy in `vite.config.ts` reads) and in `assets.run_worker_first` in `wrangler.toml` and `wrangler.example.toml`. A new error code goes in `shared/errors.ts`, and its message in `admin.errors` in `src/admin/copy.ts` (the typecheck fails until it has one). Declare guards on the route (`worker/lib/router.ts`): `limiter`, `authorize`, `cors`, `edgeCache` and `purges`. The cross-site and JSON checks on writes apply to every route.

**Adding a language.** Add the code to `site.locales` and `intlLocales`, create `src/i18n/<code>.ts` that `satisfies Messages`, register it in `DICTIONARIES` in `src/i18n/index.ts`, and add its `<head>` copy to `src/i18n/head.ts`. Each dictionary's `lang.switchTo` labels the switch to the next locale, in that language. The build writes the page to `/<code>/` with its own canonical and hreflang links. Add a section to `privacy.html`.

**Adding a banner.** `BANNERS` in `src/banners.ts` holds short, dated notices. Append an entry with a new, stable `id` (dismissals are remembered by it), `from` and `until` via `zoned('YYYY-MM-DDTHH:mm')` in the configured zone (`until` is exclusive), the `text` and an optional `link`. Copy is required in the default locale, which the others fall back to. Expired entries stop showing on their own; at most one shows at a time, the first active one not yet dismissed.

**Adding an outage source.** Extend `OUTAGE_SOURCES` in `shared/api.ts` (the schema's enum follows) and add its label to `source` in `src/admin/copy.ts`. The enum is checked in TypeScript only, so no migration is needed.

**Changing the database.** Follow the migration rules in [AGENTS.md](AGENTS.md#hard-rules): the database changes a few seconds before the code, so each migration must work with both.

## Offline support and kill switch

A service worker (`src/sw/sw.ts`, built to `dist/sw.js`) keeps the pages and the last status available offline. It is registered after load, in production builds only, and handles only same-origin GETs (`src/sw/strategy.ts`):

| Request | Strategy |
| --- | --- |
| `/`, `/en/`, `/privacy` | Network first; after `NETWORK_TIMEOUT_MS` (3 seconds) or on failure, this build's precached copy. Never stored at runtime |
| `/assets/*` | Precache, else network |
| `/api/status` | Network first; after that timeout, on failure or on a 5xx or 429, the last good status, marked `X-From-Cache: 1`. The page then shows "No connection" with the time the status was produced |
| Everything else | Not handled: writes, `/admin`, the rest of the API, the CSV, the feed, `/og.png`, `/cdn-cgi/*` and other origins |

Each build precaches into a cache named after a hash of its files and `src/sw/`, so every deploy changes `sw.js` (served with `Cache-Control: no-cache`). The new worker installs in the background, retrying at the next navigation if a precached page is redirected or references an asset the build lacks, then takes over and deletes older caches. The status cache survives deploys. An open page that needs a chunk the server no longer has reloads onto the current build.

**If the service worker misbehaves**, replace it with `scripts/sw-kill-switch.js`, which deletes the site's caches and unregisters itself; browsers pick it up at their next visit.

1. If the fault may last more than a day, first remove the registration from `src/index.tsx`.
2. Deploy the kill switch in place of the built worker:

   ```sh
   npm run build
   cp scripts/sw-kill-switch.js dist/sw.js
   npm run deploy:ci   # not "npm run deploy", which would rebuild sw.js
   ```

3. Until the fault is fixed, deploy this way every time.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # local test keys; sign in as "admin" / "test-password"
npm run db:migrate:local
npm run preview                  # build, then serve on http://localhost:8787
```

For hot reload, run `npm run build` once (the Worker serves `dist/`), then `npm run dev:worker` and `npm run dev` side by side; Vite serves the UI on port 5173 and proxies the API to the Worker.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `dev:worker` | Vite dev server / local Worker |
| `npm run build` / `preview` | Build to `dist/` / build and serve locally |
| `npm test` / `test:watch` | Vitest, once or in watch mode: the `worker` project (workerd with D1) and the `node` project (`test/node/`); `CHECK_DIST=1` also checks `dist/` |
| `npm run test:coverage` | Istanbul coverage for the Worker |
| `npm run test:e2e` | Playwright against `wrangler dev --env e2e` with a fresh local database; each run writes `.dev.vars.e2e` from `.dev.vars.example` |
| `npm run test:api` / `test:api:prod` | Bruno, by hand (below) |
| `npm run lint` / `lint:fix` / `lint:ci` | Biome: check / fix / check as CI does |
| `npm run typecheck` | Type-check the app, service worker, Worker, tests and Node scripts |
| `npm run cf-typegen` | Regenerate `worker/worker-configuration.d.ts` after a `wrangler.toml` or `.dev.vars.example` change |
| `npm run db:generate` | Create a migration after changing `worker/db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply pending migrations locally / to production |
| `npm run hash-password` | Print an `ADMIN_PASSWORD_HASH` value (input hidden) |
| `npm run og` / `icons` | Re-render the social card and icons |
| `npm run deploy` / `deploy:ci` | Build, migrate and deploy / migrate and deploy |

Lefthook runs Biome and the typecheck on commit and `npm test` on push. CI runs lint, typecheck, build, both Vitest projects (with `dist/` checks) and e2e, and fails if `wrangler types` or `drizzle-kit generate` would change a committed file.

### API tests (Bruno)

`bruno/` is a [Bruno](https://www.usebruno.com) collection: one request per endpoint, each with assertions. It runs by hand, not in CI. Start a local server with the e2e rate limits and its own database, then run the suite in a second terminal:

```sh
cp .dev.vars.example .dev.vars.e2e   # --env e2e reads this file; npm run test:e2e also writes it
cp bruno/.env.example bruno/.env
npm run build
npx wrangler d1 migrations apply DB --local --env e2e --persist-to .wrangler/bruno-state
npx wrangler dev --env e2e --port 8787 --persist-to .wrangler/bruno-state
npm run test:api
```

- The local suite uses only the test credentials from `.dev.vars.example` and deletes every outage it creates. Each run makes four of the five sign-in attempts allowed per minute, so wait a minute between runs.
- `npm run test:api:prod` runs only the `public` folder against the live site, with no credentials. The collection's pre-request script refuses anything but a public `GET` in the `production` environment.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/mooship/lights-on-garsfontein); please open an issue before a larger change. [AGENTS.md](AGENTS.md) holds the rules for changing the code, for people and AI tools alike; meet its [definition of done](AGENTS.md#definition-of-done) before opening a pull request.

By contributing, you agree that your contributions are licensed under the MIT licence.

## Licence and credits

Code: [MIT](LICENSE). Outage data: see [Using the data](#using-the-data).

Built with SolidJS, Vite, Vanilla Extract, Cloudflare Workers, D1, Drizzle ORM, Zod, Cloudflare Turnstile, Vitest, Playwright, Biome and Lefthook. Fonts: Fraunces and Plus Jakarta Sans (SIL Open Font License), via Fontsource. Icons: Lucide (ISC).
