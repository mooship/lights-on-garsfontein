# Telegram commands: design

Approved in chat on 23 October 2026. Builds on the owner's Telegram alerts (`2026-10-23-telegram-alerts-design.md`).

## Intent

The owner wants to check the power and pause the sensor from their phone, without opening `/admin` or the Mac. Only their chat is answered; nobody else can read the status this way or change anything.

## Approach

A webhook. Telegram POSTs each message to `POST /api/telegram` on the Worker, and the Worker replies in the response body (Telegram's "method in the webhook response"), so the reply is instant and needs no outbound call. Polling from the minute cron was rejected: a reply could take a minute, and remembering the last update needs a D1 row.

## Commands

All replies are English owner copy in `admin.telegram` (`src/admin/copy.ts`), which may name how an outage was recorded.

- `/status`: the status line as the site words it in English, then the owner detail the site hides:
  - the sensor: reporting (last heard at a time), paused (until a time), silent (since a time), or never reported;
  - the open outage, if any: since a time, and whether the sensor or the owner recorded it.
- `/pause <duration>`: pauses outage detection, like `lights-on pause`. A duration is a whole number with `m`, `h` or `d` (`30m`, `3h`, `2d`), at most `MAX_PAUSE_MS` (`worker/routes/status.ts`). Replies with when the pause ends. A missing, malformed, zero or too long duration gets the usage line and changes nothing. Before the sensor's first heartbeat, `pauseSensor` does nothing, and the reply says no sensor has reported yet.
- `/resume`: ends a running pause now (`pauseSensor` with `null`). Replies "Pause ended." or that nothing is paused.
- `/start`, `/help` and anything else: the list of commands.

A command may carry the bot's username (`/status@lightson_garsfontein_bot`), as Telegram's menu sends it; the suffix is ignored. Times follow the alerts: "14:05", with the date when not today, in `site.timeZone`.

## Security

- Telegram sends the secret given to `setWebhook` in `X-Telegram-Bot-Api-Secret-Token`. The route's `authorize` compares it, in constant time, with a new secret, `TELEGRAM_WEBHOOK_SECRET`. A missing or wrong header, or an unset secret, gets `401` and nothing runs.
- A message from any chat but `TELEGRAM_CHAT_ID` gets an empty `200` and no reply, so the bot gives nothing away. So does any update that is not a text message.
- Every answer to Telegram is `200` (except `401`), because Telegram retries anything else.
- A pause or resume purges `STATUS_PATH` from the edge cache, like `POST /api/heartbeat/pause`, so the site shows it at once.

## Setup

One-off, run by the operator (or Claude, with the token read from the clipboard and never printed): create the webhook secret (`openssl rand -hex 32`), set it with `wrangler secret put TELEGRAM_WEBHOOK_SECRET`, call `setWebhook` with the Worker's URL, the secret and `allowed_updates: ["message"]`, and `setMyCommands` with the three commands, so they show in Telegram's menu. The README documents these steps.

## Repository rules

- The path lives in `shared/paths.ts`; the route in `worker/routes/`, with a row in the README API table. It is not a public read, so it has no limiter and no CORS.
- A Bruno request with assertions for the `401`.
- `TELEGRAM_WEBHOOK_SECRET` goes in `.dev.vars.example` (empty) and the secrets comments in `wrangler.toml` and `wrangler.example.toml`; then `cf-typegen`.
- Privacy is unchanged: only the owner's chat is answered, and nothing about visitors is stored.

## Testing

Worker tests: `401` without, with a wrong, and with an unset secret; silence for other chats and for non-text updates; each command's reply; `/pause` durations (valid, malformed, zero, over the limit, the bot-name suffix) and its effect on the stored pause; `/resume` with and without a pause; `/pause` before any heartbeat; the edge-cache purge after a pause.
