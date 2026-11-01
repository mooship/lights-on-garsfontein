# Telegram alerts: design

Replaces the draft of 18 October 2026 (branch `telegram-alerts`), which was put on hold before push alerts shipped. The owner approved the wording then, and on 23 October 2026 asked for the build: "the alerts are only for me, nobody else".

## Intent

The owner wants a private Telegram message, from their own bot, when the power at home goes off, when it comes back, and when an alert turns out to be a false alarm. It is not a channel, not for residents and not a public feature.

## Approach

Telegram rides on the push pipeline instead of keeping its own state. `claimAlerts` already decides when an alert is due (after `ALERT_DELAY_MS`), claims each alert once, and orders off, back on and dismissed. For each claim, `enqueueAlerts` also queues one Telegram message on `PUSH_QUEUE`, next to the push pages, and the queue handler sends it. So the Telegram and push alerts always agree, and no migration or table is needed.

The draft's own state machine (an `alert_state` row compared every minute) is dropped: it would duplicate the claims and could disagree with them. One behaviour changes from the draft: the off message now waits `ALERT_DELAY_MS`, as push does, so a router reboot sends nothing.

## Messages

English, as owner copy in `src/admin/copy.ts`, which may name how an outage was recorded:

- Off, sensor outage: "No reading from home since 14:05. The power may be off."
- Off, logged by hand: "Power off at home since 14:05."
- A planned outage starts either with "Planned outage. ".
- Back on: "Power is back on at home since 16:15, after 2 h 13 min."
- Dismissed sensor outage that has ended: "False alarm: the power stayed on. The sensor was offline from 14:05 to 14:32."
- Any other dismissed outage: "False alarm: the power stayed on."

Times are in `site.timeZone`. A time on a different day from when the message is sent also shows the date ("22 Oct 14:05"). Durations use the push wording (hours and minutes, no days).

## Delivery

- `POST https://api.telegram.org/bot<token>/sendMessage` with the chat ID, plain text and no link preview.
- Before sending, the same check as push (`loadDueOutage`): an alert that no longer holds (the outage was dismissed, closed or deleted meanwhile) is not sent.
- A 429, a 5xx or a failed fetch is retried through the queue, waiting longer each time, up to `PUSH_MAX_ATTEMPTS`. Any other error status is dropped and logged with Telegram's `description`. Logs never contain the token, which is part of the URL, so a failed fetch logs only the error's name.
- There is no TTL: every message carries its own times, so a late one is still true.

## Configuration

- Two secrets, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. If either is missing or empty, no Telegram message is queued. They go in `.dev.vars.example` with empty values, so local runs and e2e send nothing.
- The README gets the setup: create the bot with @BotFather, send it `/start`, read the chat ID from `getUpdates`, and set both secrets.
- Privacy is unchanged: Telegram receives only outage times, which are public, and nothing about visitors.

## Testing

Worker tests with the fetch stubbed for `api.telegram.org`: the wording for each kind and source, the date on another day, queueing only when configured (also with no push subscribers), release of the claim when queueing fails, retries and drops by status, the due check, and that logs never contain the token.
