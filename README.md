# Lights On, Garsfontein?

[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

An open, continuous record of power outages in Garsfontein, Pretoria. The site shows whether the electricity supply is on right now and keeps a history of every outage, so residents, researchers and journalists can see how often the power goes off, for how long, and whether that is changing.

Live at **https://garsfontein.timothybrits.co.za**. Records begin on **17 October 2026**. The site is in Afrikaans by default, with an English option.

> Independent service, operated by a resident of Garsfontein Extension 16. Not affiliated with the City of Tshwane or Eskom.

## What it measures

The site records every interruption to the electricity supply at the measuring point, planned or unplanned, whatever the cause. It is not a load-shedding schedule and does not predict outages.

- **Unplanned outages** are recorded as they happen.
- **Planned outages** (announced in advance, for example for maintenance or upgrades) are tagged as planned. They still count as time without power.
- **Community confirmations**: during an outage, residents can confirm that their power is also off.

## Area covered

Measurements are taken at a home in **Garsfontein Extension 16**, in Ward 45, Region 6 of the City of Tshwane, so the record is exact for Ext. 16. The area is supplied by the **Garsfontein substation**, which is fed from **Highlands**, which in turn is fed from **Njala**. In practice a single fault on this part of the network usually affects the whole Garsfontein substation area at once, so the record is a reasonable guide for the rest of Garsfontein. An outage limited to another extension will not appear.

## Features

- **Live status**: whether the power is on or off, and for how long. The browser tab title and favicon follow the status.
- **Statistics**: hours without power, number of outages, days with an outage and the longest outage over the last 30 days, compared with the previous 30 days once enough data exists. Includes a weekly chart and table.
- **Planned outages**: outages announced in advance can be tagged as planned.
- **Community confirmations**: the "My power is off too" button records one confirmation per connection per outage, protected by Cloudflare Turnstile.
- **Open data**: every outage as CSV, plus a public JSON API.

## Using the data

The CSV and the public API are free to use.

**CSV.** [`/api/outages.csv`](https://garsfontein.timothybrits.co.za/api/outages.csv) has one row per outage, oldest first, with the columns `id`, `start_time_utc`, `end_time_utc`, `duration_minutes`, `planned` (`yes`/`no`) and `confirmations`. An outage still in progress has an empty end time and duration. Outages marked as false positives are excluded.

**API.** Times are UTC (ISO 8601); local time is SAST (UTC+2, no daylight saving). The public `GET` endpoints allow any origin and share a limit of 60 requests a minute per connection, with IPv6 addresses counted per /64. Please poll no more than once every 30 seconds.

| Endpoint | Access | Description |
| --- | --- | --- |
| `GET /api/status` | Public | `status` (`ON`/`OFF`), `since`, the open `outage`, the five most `recent` outages |
| `GET /api/stats` | Public | Last 7, 30 and 365 days, the previous 30 days, and weekly totals |
| `GET /api/outages.csv` | Public | Every outage, false positives excluded |
| `POST /api/confirm` | Public, Turnstile | Community confirmation: once per connection per outage, 5 requests a minute |
| `POST /api/heartbeat` | Sensor token | Sensor check-in |
| `POST /api/admin/login`, `/logout` | Username, password, Turnstile | Sets an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie; the session lasts 30 days after the last visit |
| `GET`/`POST /api/admin/outages`, `POST /api/admin/timer` | Session or API token | Manage outages and the punch clock |

Statistics only count time since records began. The public site and API never say how an outage was recorded.

A plain-text summary for language models is served at [`/llms.txt`](https://garsfontein.timothybrits.co.za/llms.txt).

## Recording outages

Outages are recorded by a heartbeat sensor, by hand on the admin page, or both.

**Admin page.** Sign in at `/admin`. Tap **Punch out** when the power goes off and **Punch in** when it is restored. **Log a past outage** adds anything missed. Each outage can be marked **Planned** or **False positive**, closed or deleted. With no open outage and no sensor reporting, the status is on.

Outages from before 17 October 2026 can be added for the history and CSV, but statistics only count time from the start date, so untracked days never improve the figures. To change the start date, edit `TRACKING_SINCE` in `shared/api.ts`.

**Scripts and AI agents.** Admin endpoints also accept `Authorization: Bearer <ADMIN_API_TOKEN>`. Failed attempts count towards the sign-in rate limit. Keep the URL and token in a git-ignored `.env` (`GARSFONTEIN_URL`, `GARSFONTEIN_ADMIN_TOKEN`).

```sh
# The power went off (use "punch_in" when it is restored)
curl -X POST "$GARSFONTEIN_URL/api/admin/timer" \
  -H "Authorization: Bearer $GARSFONTEIN_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"punch_out"}'

# Log an outage after the fact (include the offset; SAST is +02:00)
curl -X POST "$GARSFONTEIN_URL/api/admin/outages" \
  -H "Authorization: Bearer $GARSFONTEIN_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"create","startTime":"2026-10-17T05:52:00+02:00","endTime":"2026-10-17T11:15:00+02:00","isPlanned":false}'

# List recent outages, then correct one by id
curl "$GARSFONTEIN_URL/api/admin/outages" -H "Authorization: Bearer $GARSFONTEIN_ADMIN_TOKEN"
curl -X POST "$GARSFONTEIN_URL/api/admin/outages" \
  -H "Authorization: Bearer $GARSFONTEIN_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"update","id":3,"endTime":"2026-10-17T11:20:00+02:00"}'
```

To rotate the token, generate a new one, run `npx wrangler secret put ADMIN_API_TOKEN` and update `.env`.

**Heartbeat sensor.** Any always-on device powered from the mains without a UPS will do. It sends a heartbeat every minute. After three minutes without a heartbeat an outage opens automatically, and the next heartbeat closes it. Heartbeats are refused until `HEARTBEAT_TOKEN` is set.

```sh
npx wrangler secret put HEARTBEAT_TOKEN
```

Raspberry Pi, or an old Android phone with Termux (crontab):

```cron
* * * * * curl -fsS -m 20 -X POST -H "Authorization: Bearer YOUR_TOKEN" https://garsfontein.timothybrits.co.za/api/heartbeat >/dev/null
```

ESP32 (Arduino IDE with ESP32 Arduino core 3.3 or later; about R100 of hardware and a USB charger). The sketch verifies the server's certificate against the root certificates built into the core:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
const char* TOKEN     = "YOUR_TOKEN";
const char* URL       = "https://garsfontein.timothybrits.co.za/api/heartbeat";

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

If the internet connection drops while the power stays on, the sensor goes quiet and an outage is logged; mark it as a false positive. The punch clock works alongside a sensor, and heartbeats only close outages the sensor opened.

## Tech stack

| Layer | Tools |
| --- | --- |
| Front end | SolidJS, Vite, Vanilla Extract, Lucide icons |
| Back end | Cloudflare Workers (static assets and API), D1 with Drizzle ORM, Zod |
| Security | Cloudflare Turnstile, Workers rate limiting, PBKDF2 password hashing, strict CSP |
| Quality | Vitest in the Workers runtime, Playwright, Biome, Lefthook, GitHub Actions, Dependabot |

## Local development

Requires Node 24.

```sh
npm install
cp .dev.vars.example .dev.vars   # local test keys; sign in as "admin" / "test-password"
npm run db:migrate:local
npm run preview                  # build, then serve on http://localhost:8787
```

For hot reload, run `npm run dev:worker` and `npm run dev` side by side. Vite serves the UI on port 5173 and proxies API calls to the Worker. Run `npm run build` once first: the Worker serves its static assets from `./dist` and will not start without it.

| Command | Purpose |
| --- | --- |
| `npm test` / `npm run test:watch` | Worker unit and integration tests, once or in watch mode |
| `npm run test:e2e` | Browser tests against a fresh local Worker and database |
| `npm run lint` / `npm run lint:fix` | Lint and format with Biome |
| `npm run lint:ci` | Lint and format check without writing changes, as CI runs it |
| `npm run typecheck` | Type-check the app, Worker, tests and scripts |
| `npm run cf-typegen` | Regenerate `worker/worker-configuration.d.ts` after changing `wrangler.toml` |
| `npm run db:generate` | Create a migration after changing `worker/db/schema.ts` |
| `npm run db:migrate:remote` | Apply pending migrations to the production database |
| `npm run hash-password` | Print an `ADMIN_PASSWORD_HASH` value (input hidden) |
| `npm run og` / `npm run icons` | Re-render the social cards and app icons |

## Deployment and self-hosting

The site runs on a single Cloudflare Worker with a D1 database. The Worker, database, rate limits, cron triggers and custom domain are defined in `wrangler.toml`; to run your own instance for another area, change the names, domain and `SITE_URL` there, and the area and start date in the copy and `shared/api.ts`.

Two cron triggers run the Worker on a schedule (`crons = ["* * * * *", "0 * * * *"]`). Every minute it checks for a silent sensor and opens an outage. Every hour it removes expired sessions and clears the hashed connection fingerprints from confirmations older than 30 days (the counts are kept).

```sh
npx wrangler login
npx wrangler secret put ADMIN_USERNAME                     # your sign-in name (case-insensitive)
npm run --silent hash-password | npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget
npx wrangler secret put IP_SALT                # a long random string; never change it
npm run deploy                                 # build, apply migrations, deploy
```

Optional secrets: `ADMIN_API_TOKEN` (scripts and agents) and `HEARTBEAT_TOKEN` (a sensor).

**Changing the admin password.** Set a new hash as above. Each session stores a short fingerprint of `ADMIN_PASSWORD_HASH`, so every existing session is refused (and deleted) on its next use; nothing needs to be cleared by hand. Sessions are extended for 30 days after the last visit but never last more than 90 days after sign-in.

**Continuous deployment.** Cloudflare Workers Builds deploys every push to `main` with `npm run deploy:ci`, which applies pending D1 migrations first and only then deploys the new code. If a migration fails, the deploy stops and the previous version stays live. Pull requests are tested by GitHub Actions and are not deployed.

**Writing migrations.** The database changes a few seconds before the code does, so every migration must work with both the old and the new code:

- Add before you use: add a column or table in one release, start using it in the next.
- Remove after you stop using: stop reading a column in one release, drop it in a later one.
- Give new columns a default (or make them nullable) so the old code can still insert rows.
- Never rename in place. Add the new name, copy the data, switch the code over, then drop the old name.
- Check what drizzle-kit generates. On SQLite it sometimes rebuilds a whole table, and on D1 that can cascade-delete related rows (see `drizzle/0003_boolean_flags.sql`).

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/mooship/lights-on-garsfontein). Please open an issue before starting on a larger change.

- Lefthook runs Biome and the type check on commit, and the unit tests on push. CI also runs the end-to-end tests.
- User-facing text lives in `src/i18n/af.ts` (the source and default) and `src/i18n/en.ts`; add every new string to both.
- The public site and API must never reveal how an outage was recorded.

By contributing, you agree that your contributions are licensed under the MIT licence.

## Licence

[MIT](LICENSE). Fonts: Fraunces and Plus Jakarta Sans (SIL Open Font License). Icons: Lucide (ISC).
