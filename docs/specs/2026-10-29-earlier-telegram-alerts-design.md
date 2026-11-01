# Earlier Telegram alerts: design

On 29 October 2026 the owner asked for the Telegram alerts to come in sooner than the push alerts' ten minutes, and chose a delay of their own for Telegram over lowering the shared one.

## Approach

Telegram gets its own claims. `outages` gains `telegram_off_alert_at` and `telegram_on_alert_at`, which mean for Telegram what `off_alert_at` and `on_alert_at` mean for push (`worker/db/schema.ts`). `claimAlerts` takes a channel (`PUSH_CHANNEL` or `TELEGRAM_CHANNEL` in `worker/lib/alerts.ts`): its delay and the two columns it claims into. Everything else (the rules for off, back on and dismissed, and the single conditional UPDATE per kind) is shared.

- `TELEGRAM_ALERT_DELAY_MS` is 5 minutes, counted from the outage's start like `ALERT_DELAY_MS`. A sensor outage starts at the last heartbeat and opens once the sensor has been silent for `HEARTBEAT_THRESHOLD_MS`, so the delay stays above that threshold. Push keeps `ALERT_DELAY_MS`.
- The earlier message is a heads-up that can be wrong: a heartbeat that returns dismisses the outage, and Telegram then sends the "false alarm" follow-up, as push does.
- An outage can end between the two delays. Telegram sends off and back on; push sends nothing, because its off was never claimed.
- The minute cron claims and queues Telegram first, and only when both secrets are set, so an unconfigured Telegram claims nothing and a failure in one channel does not stop the other. `enqueueTelegramAlerts` queues one message per claim, with no push pages.
- `loadDueOutage` and the claim release take the channel, so an undone dismissal releases the Telegram column for a Telegram job and the push column for a push job.
- Deleting an outage is refused while either channel's off alert awaits its follow-up (`ERROR.alertSent`).

## Migration

Two nullable columns, so old and new code both work across the deploy. A second, data-only migration copies the push claims into the Telegram columns, so an outage already alerted at deploy time sends no second Telegram "off" and still gets its "back on". It is not schema SQL: it is generated with `drizzle-kit generate --custom` and holds only the two UPDATEs.

## Testing

Worker tests: a Telegram claim at its own delay while push waits; an outage that ends between the delays (Telegram off and on, push nothing); the channels claiming independently and never one another's column; a release that clears only the job's own channel; the delete guard for a Telegram-only claim; the cron queuing Telegram first and only when configured; the backfill.
