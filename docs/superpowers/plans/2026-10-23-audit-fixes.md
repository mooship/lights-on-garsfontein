# Audit fixes

Findings from a security, performance, code quality and accessibility audit on 23 October 2026, after triage. Each group is one pull request. Every fix starts with a failing test where behaviour changes (AGENTS.md, principle 2).

## 1. Privacy page

- Drop the paragraph about residents formerly reporting outages, in both languages.

## 2. Worker hardening (`fix/worker-hardening`)

- Open outages created or reopened by the admin API go through the atomic `openOutage` (`worker/lib/grid.ts`), so two concurrent calls cannot leave two open outages.
- Deleting an outage whose off alert was sent, with no follow-up yet, is refused with a new error code; the admin marks it a false positive instead, which sends the correction.
- The queue handler catches a thrown delivery and re-sends the job with `attempt + 1` up to `PUSH_MAX_ATTEMPTS`, logging only the error name.
- Outbound fetches (push, Telegram, Turnstile) get a timeout from one named constant.
- Push requests use `redirect: 'manual'`, so a redirect cannot take the VAPID token to a host outside `PUSH_HOSTS`.
- `parseBody` refuses a body over a named size limit before parsing.
- `GET /api/outages` and the CSV select only the columns they use.
- The edge-cache store runs in `ctx.waitUntil`; purges stay awaited.
- README: how to generate `HEARTBEAT_TOKEN` and `ADMIN_API_TOKEN`, and accurate wording on what the sign-in limit does for bearer tokens.

## 3. Alert index (`perf/alert-pending-index`)

- A partial index on `off_alert_at` where `on_alert_at` is null, so the minute cron's follow-up claims stop scanning the table. Generated with `npm run db:generate`; it only adds an index.

## 4. Accessibility and copy (`fix/a11y-copy`)

- Scroll padding while the alerts card is open, so keyboard focus is never hidden under it.
- An hourly table in the figures `<details>` as the by-hour chart's text alternative.
- One announcement for the alerts card: no live region around the whole card, none nested in the failed message.
- Stale-data warnings use `role="status"`; the unreachable-server error stays `role="alert"`.
- The lock-screen off alert names the measuring point rather than all of Ext. 16.
- The alerts bell is a toggle only when pressing it toggles.
- Admin: readable false-positive rows; "Ended" cannot be in the future.
- English phrases inside Afrikaans copy are marked `lang="en"`.
- Returning to the tab refetches the status only when the last poll is older than half of `POLL_MS`.

## 5. Code quality (`refactor/audit-tidy`, after 2)

- The feed formats durations with `formatDurationIn`, matching the page.
- `SECOND_MS` in `shared/api.ts`; durations built from the shared constants.
- `HEARTBEAT_ROW_ID` beside the heartbeat table.
- Unexport `releaseClaim`, `isPushEndpoint` and `PUSH_HOSTS`.
- Reasons on empty `catch` handlers; plain `DAY_MS` and `HOUR_MS` imports in `stats.ts`; drop the redundant check in `src/admin/sensor.ts`; trim the CSV contract comment; drop the extra literals in `test/alerts.test.ts`.

## Not done

- Deleting push subscriptions on 400: a fault in our own encryption would also return 400 and wipe every real subscriber. Rate limiting bounds the junk.
- Moving the masthead notice into `<header>` and single `<h1>` on bilingual pages: small gain against the zero-layout-shift shell.
- Preloading the display font: `font-display: optional` is deliberate.
- For the owner: check whether persisted Cloudflare traces store the Telegram bot URL or push endpoints, and decide whether `lights-on update` should pin a release.
