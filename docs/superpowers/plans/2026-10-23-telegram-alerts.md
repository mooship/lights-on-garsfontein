# Telegram alerts: plan

Spec: `docs/superpowers/specs/2026-10-23-telegram-alerts-design.md`. Each step is red, green, refactor.

1. **Secrets.** Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (empty) to the end of `.dev.vars.example`, list them in the secrets comments of `wrangler.toml` and `wrangler.example.toml`, and run `npm run cf-typegen`.
2. **Copy and wording.** `admin.telegram` in `src/admin/copy.ts`; `telegramText(kind, outage, now)` in `worker/lib/telegram.ts`. Tests: each kind and source, planned, the date on another day.
3. **Shared due check.** Move `loadDueOutage` from `worker/lib/deliver.ts` to `worker/lib/alerts.ts` and export it, taking a claim with `queuedAt`; also share `RETRY_DELAY_SECONDS` as `ALERT_RETRY_DELAY_SECONDS`.
4. **Queueing.** `TelegramAlert` and `AlertJob = AlertPage | TelegramAlert` in `alerts.ts`; `enqueueAlerts(..., { telegram })` queues one Telegram message per claim ahead of its pages. The cron passes `telegramConfigured(env)`. Tests: queued only when configured, also with no subscribers; a failed enqueue releases the claim.
5. **Delivery.** `deliverTelegramAlert(alert, env)` in `telegram.ts`; the queue handler routes by `channel`. Tests: sends the text to the chat; skips an alert no longer due; retries on 429, 5xx and a rejected fetch up to `PUSH_MAX_ATTEMPTS`; drops other statuses with Telegram's description; never logs the token; does nothing once unconfigured.
6. **README.** The setup steps and the secrets table.
7. **Definition of done** from AGENTS.md, then the pull request.
