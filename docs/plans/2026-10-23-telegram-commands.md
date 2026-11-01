# Telegram Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/status`, `/pause <duration>` and `/resume` on the owner's private Telegram bot.

**Architecture:** Telegram POSTs updates to `POST /api/telegram`. The route checks the secret header, ignores every chat but the owner's, runs the command and answers with a `sendMessage` method in the webhook response body. The commands reuse `getGridState`, `getOpenOutage` and `pauseSensor` (`worker/lib/grid.ts`), `sensorState` (`src/admin/sensor.ts`) and the admin copy.

**Tech Stack:** Cloudflare Worker, D1 via Drizzle, Vitest in workerd.

**Spec:** `docs/superpowers/specs/2026-10-23-telegram-commands-design.md`

## Global Constraints

- Only `TELEGRAM_CHAT_ID` gets replies; any other chat or non-text update gets an empty `200`.
- Missing, wrong or unset `TELEGRAM_WEBHOOK_SECRET` → `401`, compared with `safeEqual` (`worker/lib/crypto.ts`).
- Copy is English owner copy in `admin.telegram` (`src/admin/copy.ts`); reuse `admin.sensor.*`, `admin.source` and the English `status` dictionary entries rather than repeating them.
- Unless the sensor is monitored (`monitored` from `getGridState`), `ON` reads `NO_OUTAGE_REPORTED` (`en.status.NONE`), as AGENTS.md requires.
- Durations: `^(\d+)([mhd])$`, more than 0 and at most `MAX_PAUSE_MS`.
- Times through `formatAt` in `worker/lib/telegram.ts` ("14:05", or "22 Oct 14:05" on another day).
- No new dependency, no migration.

## Review Focus

1. `/pause 3H`, `/pause 3 h` or `/pause` alone: the usage line, no change. *(Task 1 tests.)*
2. `/status@lightson_garsfontein_bot` from the menu: treated as `/status`. *(Task 1 test.)*
3. An edited message or a photo (`edited_message`, a message without `text`): empty `200`. *(Task 2 test.)*
4. A forged request with the right chat ID but no secret header: `401`, nothing paused. *(Task 2 test.)*
5. `/pause 31d`: refused with the usage line, as the API refuses `pause_too_long`. *(Task 1 test.)*

---

### Task 1: Commands

**Files:**
- Create: `worker/lib/telegram-commands.ts`
- Modify: `src/admin/copy.ts` (`admin.telegram`), `worker/lib/telegram.ts` (export `formatAt`)
- Test: `test/telegram-commands.test.ts`

**Interfaces:**
- Consumes: `formatAt(iso: string, now: Date): string` (now exported from `worker/lib/telegram.ts`), `getGridState`, `getOpenOutage`, `pauseSensor` (`worker/lib/grid.ts`), `sensorState` (`src/admin/sensor.ts`), `MAX_PAUSE_MS` (`worker/routes/status.ts`).
- Produces: `parsePause(arg: string): number | null` (ms, or null when invalid) and `runCommand(text: string, db: Db, now: Date): Promise<{ text: string; statusChanged: boolean }>`.

- [ ] **Step 1: Write the failing tests** in `test/telegram-commands.test.ts`, taking copy from `admin.telegram`, `admin.sensor` and `DICTIONARIES.en.status`:
  - `parsePause`: `'30m'` → `30 * MINUTE_MS`, `'3h'` → `3 * HOUR_MS`, `'2d'` → `2 * DAY_MS`, `'30d'` → `MAX_PAUSE_MS`; `null` for `''`, `'3H'`, `'3 h'`, `'0h'`, `'31d'`, `'1.5h'`, `'h'`.
  - `/status` with a fresh heartbeat: the `ON` line, then `admin.sensor.reporting(time)`.
  - `/status` with a stale heartbeat and an open sensor outage: the `OFF` line, `admin.sensor.silent(...)` and `admin.telegram.outage(time, admin.source.sensor)`.
  - `/status` with no heartbeat ever: the `NONE` line (not monitored) and `admin.sensor.never`.
  - `/status` while paused: the `NONE` line and `admin.sensor.paused(time)`.
  - `/status@lightson_garsfontein_bot` answers as `/status`.
  - `/pause 3h` after a heartbeat: reply `admin.telegram.paused(time)`, `statusChanged: true`, and `heartbeats.paused_until` is `now + 3h`.
  - `/pause`, `/pause 31d`, `/pause 3H`: reply `admin.telegram.usage`, `statusChanged: false`, no pause stored.
  - `/pause 3h` before any heartbeat: `admin.sensor.never`, `statusChanged: false`.
  - `/resume` while paused: `admin.telegram.resumed`, `statusChanged: true`, pause ended; without a pause: `admin.telegram.notPaused`, `statusChanged: false`.
  - `/start`, `/help`, `hello`: `admin.telegram.help`.
  - One literal smoke string: `admin.telegram.help` contains `/status`, `/pause` and `/resume`.

- [ ] **Step 2: Run** `npx vitest run --project worker test/telegram-commands.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Add copy** to `admin.telegram`: `help`, `usage` ("Use /pause with a duration such as 30m, 3h or 2d, up to 30 days." — note at `MAX_PAUSE_MS` that it is coupled), `paused(until)`, `resumed`, `notPaused`, `outage(since, source)` ("Outage open since 14:05 (sensor).").

- [ ] **Step 4: Implement** `parsePause` and `runCommand` in `worker/lib/telegram-commands.ts`. The command is the first word with any `@…` suffix removed. `/status` joins lines with `\n`: the status line (`OFF` → `en.status.OFF`; `ON` and monitored → `en.status.ON`; otherwise `en.status.NONE`), the sensor line from `sensorState` (read `heartbeats` row id 1 for `lastSeen` and `pausedUntil`), and the outage line when `getOpenOutage` returns one. Export `formatAt` from `telegram.ts`.

- [ ] **Step 5: Run** the test file again — expect PASS.

- [ ] **Step 6: Commit** `feat: answer the owner's telegram commands`.

### Task 2: Webhook route, configuration and docs

**Files:**
- Create: `worker/routes/telegram.ts`, `bruno/telegram/webhook-unauthorized.bru` (follow the existing folder layout in `bruno/`)
- Modify: `shared/paths.ts` (`TELEGRAM_WEBHOOK_PATH = '/api/telegram'`), `worker/routes/index.ts`, `.dev.vars.example` (append `TELEGRAM_WEBHOOK_SECRET=""`), `wrangler.toml` and `wrangler.example.toml` (secrets comment), `worker/worker-configuration.d.ts` (`npx wrangler types worker/worker-configuration.d.ts --env-file .dev.vars.example`), `README.md` (API table row; "Owner alerts on Telegram" gets the commands and the webhook setup)
- Test: `test/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `runCommand` from Task 1, `telegramConfigured` and `TELEGRAM_HOST` from `worker/lib/telegram.ts`, `purgeEdgeCache` and `Routes` from `worker/lib/router.ts`.
- Produces: `telegramRoutes: Routes`; the header name `TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token'` exported from `worker/routes/telegram.ts`.

- [ ] **Step 1: Write the failing tests** with `call(TELEGRAM_WEBHOOK_PATH, { method: 'POST', body: update, headers, env })`, where `env` sets the three `TELEGRAM_*` secrets:
  - No header, a wrong header, and the right header with `TELEGRAM_WEBHOOK_SECRET: ''`: `401`, and `/pause 3h` stored nothing.
  - The right header and the owner's chat sending `/status`: `200`, JSON `{ method: 'sendMessage', chat_id: <owner id>, text: <runCommand text>, link_preview_options: { is_disabled: true } }`.
  - Another chat ID, an `edited_message`, and a message without `text`: `200` with an empty body, and no pause stored.
  - `/pause 3h` from the owner: `/api/status` reads `monitored: false` straight after (the edge cache was purged).
  - A body that is not JSON: `200` with an empty body.

- [ ] **Step 2: Run** `npx vitest run --project worker test/telegram-webhook.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** the route: `authorize` compares the header with `safeEqual`, refusing when the secret is unset; the handler parses the body loosely (no throw on bad JSON), checks `message.chat.id` against `TELEGRAM_CHAT_ID` as strings and that `message.text` is a string, calls `runCommand`, and purges `[STATUS_PATH]` when `statusChanged`. Add the path, register the route, and update the config, types, Bruno request and README as listed above.

- [ ] **Step 4: Run** the test file again — expect PASS.

- [ ] **Step 5: Commit** `feat: take the owner's telegram commands through a webhook`.

### Task 3: Definition of done, pull request and setup

- [ ] **Step 1:** `npm run lint:ci`, `npm run typecheck`, `npm run build`, `CHECK_DIST=1 npm test`, `npm run test:e2e` — all pass.
- [ ] **Step 2:** Push, `gh pr create`, `gh pr checks --watch`, `gh pr merge --merge --delete-branch`.
- [ ] **Step 3 (after deploy, with the owner):** with the bot token on the clipboard, generate the webhook secret, set `TELEGRAM_WEBHOOK_SECRET` with `wrangler secret bulk`, call `setWebhook` (`url: <site>/api/telegram`, `secret_token`, `allowed_updates: ["message"]`) and `setMyCommands` (`status`, `pause`, `resume`), never printing the token; then the owner sends `/status`.
