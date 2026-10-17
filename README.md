# Garsfontein Grid

**How bad are the power outages in Garsfontein?** Garsfontein Grid is a community record of electricity outages in Ward 45, Garsfontein, Pretoria. It shows whether the power is on right now, and it keeps a history so anyone can see whether things are getting better or worse.

> **A volunteer project.** Not affiliated with the City of Tshwane, Eskom or any government body.

Live at **https://garsfontein.timothybrits.co.za** · Outage tracking began on **18 October 2026**.

## What it does

- **Live status.** ON or OFF, with how long it has been that way.
- **"How bad is it?"** Hours without power, outage count, share of time with power and the longest outage over the last 30 days, compared with the previous 30 days. Includes a weekly chart.
- **History and open data.** Recent outages on the page, and every outage as CSV at [`/api/outages.csv`](https://garsfontein.timothybrits.co.za/api/outages.csv).
- **"My power is off too".** Neighbours can confirm an outage: one confirmation per connection per outage, protected by Cloudflare Turnstile and rate limiting. IP addresses are stored only as salted hashes.
- **Works without a sensor.** Until a sensor is installed, the admin's punch clock drives the status (see [Running without a sensor](#running-without-a-sensor)).

## Stack

SolidJS + Vite + Vanilla Extract on the front end. Cloudflare Workers (static assets plus API), D1 with Drizzle ORM, Zod and Turnstile on the back end. Testing and tooling: Vitest in the Workers runtime (`@cloudflare/vitest-plugin`), Playwright, Biome, Lefthook and GitHub Actions. Icons come from [Lucide](https://lucide.dev).

See [`SPEC.md`](SPEC.md) for the original specification and [Changes from the spec](#changes-from-the-spec) for where this differs.

## Local development

Requires Node 24.

```sh
npm install
cp .dev.vars.example .dev.vars     # local test keys; admin password is "test-password"
npm run db:migrate:local
npm run preview                    # build + wrangler dev on http://localhost:8787
```

For hot reload, run `npm run dev:worker` and `npm run dev` side by side. Vite serves the UI on port 5173 and proxies the API to the Worker.

| Command | What it does |
| --- | --- |
| `npm test` | Worker unit and integration tests (Vitest in workerd) |
| `npm run test:e2e` | Playwright against a fresh local Worker and D1 |
| `npm run lint` / `lint:fix` | Biome |
| `npm run typecheck` | TypeScript for app, Worker and scripts |
| `npm run db:generate` | New Drizzle migration after editing `worker/db/schema.ts` |
| `npm run hash-password` | Prints an `ADMIN_PASSWORD_HASH` value (input hidden) |
| `npm run og` / `npm run icons` | Re-render social cards and app icons |

## Deploying

The Worker, D1 database and custom domain are defined in `wrangler.toml`. Set the secrets once:

```sh
npx wrangler login
npm run --silent hash-password | npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget
npx wrangler secret put IP_SALT                # any long random string; never change it
npm run deploy
```

`HEARTBEAT_TOKEN` is needed only once you add a sensor.

**Continuous deployment.** CI runs on every PR and every push to `main`. To deploy automatically from `main`:

1. Create a Cloudflare API token with the *Edit Cloudflare Workers* template plus *D1: Edit*.
2. Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Set the repository variable `DEPLOY_ENABLED` to `true`.

## Running without a sensor

Until the first sensor heartbeat arrives, the site runs in **manual mode**:

- The status is **ON** unless an outage is open.
- Sign in at `/admin`. When the power goes off, tap **Punch out**: the status turns OFF and a timer starts. When it comes back, tap **Punch in**.
- Use **Log a past outage** to add outages after the fact, and **False positive** or **Delete** to correct mistakes.
- The page tells visitors the status is reported by hand.

Outages from before 18 October 2026 can be added and will appear in the history and CSV. The statistics only count time from the tracking start, so untracked days never make the numbers look better than they were. To change the start date, edit `TRACKING_SINCE` in `shared/api.ts`.

## Adding a sensor

Any always-on device that runs from **mains power without a UPS** works. When the power goes off it stops checking in, and after 3 minutes of silence the site opens an outage automatically. When it checks in again, the outage closes.

1. Pick a long random token and store it:
   ```sh
   npx wrangler secret put HEARTBEAT_TOKEN
   ```
2. Make the device send this once a minute:
   ```sh
   curl -fsS -X POST -H "Authorization: Bearer $HEARTBEAT_TOKEN" https://garsfontein.timothybrits.co.za/api/heartbeat
   ```

That is all. The first heartbeat switches the site to **sensor mode** with no deploy or config change.

**Raspberry Pi or old phone running Termux** (crontab):

```cron
* * * * * curl -fsS -m 20 -X POST -H "Authorization: Bearer YOUR_TOKEN" https://garsfontein.timothybrits.co.za/api/heartbeat >/dev/null
```

**ESP32** (Arduino IDE, about R100 of hardware plus a USB charger in a wall socket):

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
    client.setInsecure();  // token auth; skip CA pinning to keep the sketch simple
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

**Caveats.**
- If your internet drops while the power stays on, the sensor goes quiet and an outage is logged. Mark it as a **False positive** in `/admin`.
- The punch clock still works in sensor mode. Sensor heartbeats close only sensor outages, so manual outages stay yours to close.

## API

All times are UTC ISO 8601. Public endpoints allow any origin (CORS) and are rate limited to 60 requests a minute per IP.

| Endpoint | Description |
| --- | --- |
| `GET /api/status` | `status` (`ON`/`OFF`), `mode` (`manual`/`sensor`), `since`, `lastSeen`, open `outage`, five `recent` outages |
| `GET /api/stats` | Last 7, 30 and 365 days, previous 30 days, and weekly totals |
| `GET /api/outages.csv` | Every outage, false positives removed |
| `POST /api/confirm` | `{ token }` from Turnstile. 5 a minute per IP, one per IP per outage |
| `POST /api/heartbeat` | Sensor check-in. `Authorization: Bearer <HEARTBEAT_TOKEN>` |
| `POST /api/admin/login`, `/logout` | Session cookie `admin_session` (HttpOnly, Secure, SameSite=Strict, 12 h) |
| `GET/POST /api/admin/outages`, `POST /api/admin/timer` | Admin only |

Machine-readable summary: [`/llms.txt`](https://garsfontein.timothybrits.co.za/llms.txt).

## Changes from the spec

- **Storybook dropped.** Components are covered by Playwright instead.
- **Manual mode added** so the site works before a sensor exists. The `UNKNOWN` status was removed, so the status is always `ON` or `OFF`.
- **Trend statistics, the weekly chart, `/api/stats` and the CSV export added**, because the point of the site is to show change over time.
- **`robots.txt` is served by the Worker** (as is the sitemap), so `public/robots.txt` does not exist.
- **Social cards are pre-rendered PNGs** (one per status). `/og.png` serves the one matching the live status, which avoids shipping an image renderer in the Worker.
- **Heartbeats need a bearer token**, which the spec left open.
- **Passwords use PBKDF2-SHA256 through Web Crypto** (100,000 iterations, the Workers maximum).
- **JSON-LD uses `Service`, not `GovernmentService`,** so search engines never present a volunteer project as an official one.

## Licence

[GPL-3.0-only](LICENSE). Fonts: Fraunces and Plus Jakarta Sans (SIL Open Font License). Icons: Lucide (ISC).
