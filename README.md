# Garsfontein Grid

A running record of power outages in Garsfontein, Pretoria. It shows whether the power is on right now and keeps a history of every outage, so it is easy to see how often the power goes off and whether that is changing.

Live at **https://garsfontein.timothybrits.co.za**. Records start on **17 October 2026**.

> Run by a Garsfontein resident. Not affiliated with the City of Tshwane or Eskom.

## Area covered

Garsfontein is in Ward 45, Region 6 of the City of Tshwane. Homes are supplied by the **Garsfontein substation**, which is fed from **Highlands**, which is fed from **Njala**. Much of that equipment has little modern protection, so a single fault usually cuts the whole Garsfontein substation area at once. One household's record is therefore a fair guide for the neighbourhood.

## Features

- **Live status**: on or off, and for how long. The tab title and favicon follow the status.
- **By the numbers**: hours without power, number of outages, days affected and the longest outage over the last 30 days, compared with the 30 days before once there is enough data. Includes a weekly chart and table.
- **Planned work**: outages announced in advance can be tagged as planned. They still count as time without power.
- **"My power's off too"**: during an outage, neighbours can add a confirmation. One per connection per outage, behind Cloudflare Turnstile.
- **Open data**: every outage as CSV, plus a public JSON API.

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

For hot reload, run `npm run dev:worker` and `npm run dev` side by side. Vite serves the UI on port 5173 and proxies API calls to the Worker.

| Command | Purpose |
| --- | --- |
| `npm test` | Worker unit and integration tests |
| `npm run test:e2e` | Browser tests against a fresh local Worker and database |
| `npm run lint` / `npm run lint:fix` | Lint and format with Biome |
| `npm run typecheck` | Type-check the app, Worker and scripts |
| `npm run db:generate` | Create a migration after changing `worker/db/schema.ts` |
| `npm run hash-password` | Print an `ADMIN_PASSWORD_HASH` value (input hidden) |
| `npm run og` / `npm run icons` | Re-render the social cards and app icons |

## Deployment

The Worker, database, rate limits and custom domain are defined in `wrangler.toml`.

```sh
npx wrangler login
npx wrangler secret put ADMIN_USERNAME                     # your sign-in name (case-insensitive)
npm run --silent hash-password | npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget
npx wrangler secret put IP_SALT                # a long random string; never change it
npm run deploy                                 # build, apply migrations, deploy
```

Optional secrets: `ADMIN_API_TOKEN` (scripts and agents) and `HEARTBEAT_TOKEN` (a sensor).

**Changing the admin password.** Set a new hash as above, then sign out every existing session:

```sh
npx wrangler d1 execute DB --remote --command "DELETE FROM sessions"
```

**Continuous deployment.** CI runs on every pull request and every push to `main`. To deploy automatically from `main`, create a Cloudflare API token limited to *Workers Scripts: Edit* and *D1: Edit* on this account, add it with your account ID as the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and set the repository variable `DEPLOY_ENABLED` to `true`.

## Recording outages

**Admin page.** Sign in at `/admin`. Tap **Punch out** when the power goes off and **Punch in** when it returns. **Log a past outage** adds anything missed. Each outage can be marked **Planned** or **False positive**, closed or deleted. With no open outage and no sensor reporting, the status is on.

The public site and API never say how an outage was recorded.

Outages from before 17 October 2026 can be added for the history and CSV, but statistics only count time from the start date, so days nobody was tracking never improve the numbers. To change the start date, edit `TRACKING_SINCE` in `shared/api.ts`.

**Scripts and AI agents.** Admin endpoints also accept `Authorization: Bearer <ADMIN_API_TOKEN>`. Failed attempts count towards the sign-in rate limit. Keep the URL and token in a git-ignored `.env` (`GARSFONTEIN_URL`, `GARSFONTEIN_ADMIN_TOKEN`).

```sh
# The power went off (use "punch_in" when it returns)
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

**Heartbeat sensor.** Any always-on device powered from the mains without a UPS will do. It sends a heartbeat every minute. After three minutes of silence an outage opens automatically, and the next heartbeat closes it. Heartbeats are refused until `HEARTBEAT_TOKEN` is set.

```sh
npx wrangler secret put HEARTBEAT_TOKEN
```

Raspberry Pi, or an old Android phone with Termux (crontab):

```cron
* * * * * curl -fsS -m 20 -X POST -H "Authorization: Bearer YOUR_TOKEN" https://garsfontein.timothybrits.co.za/api/heartbeat >/dev/null
```

ESP32 (Arduino IDE; about R100 of hardware and a USB charger):

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
    client.setInsecure();  // token auth; skips certificate pinning to keep the sketch short
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

If the internet drops while the power stays on, the sensor goes quiet and an outage is logged; mark it as a false positive. The punch clock keeps working alongside a sensor, and heartbeats only close outages the sensor opened.

## API

Times are UTC (ISO 8601). Public endpoints allow any origin and are limited to 60 requests a minute per connection.

| Endpoint | Access | Description |
| --- | --- | --- |
| `GET /api/status` | Public | `status` (`ON`/`OFF`), `since`, the open `outage`, the five most `recent` outages |
| `GET /api/stats` | Public | Last 7, 30 and 365 days, the previous 30 days, and weekly totals |
| `GET /api/outages.csv` | Public | Every outage, false positives removed |
| `POST /api/confirm` | Public, Turnstile | "My power's off too": once per connection per outage, 5 requests a minute |
| `POST /api/heartbeat` | Sensor token | Sensor check-in |
| `POST /api/admin/login`, `/logout` | Username, password, Turnstile | Sets an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie for 12 hours |
| `GET`/`POST /api/admin/outages`, `POST /api/admin/timer` | Session or API token | Manage outages and the punch clock |

A plain-text summary for language models is served at [`/llms.txt`](https://garsfontein.timothybrits.co.za/llms.txt).

## Licence

[GPL-3.0-only](LICENSE). Fonts: Fraunces and Plus Jakarta Sans (SIL Open Font License). Icons: Lucide (ISC).
