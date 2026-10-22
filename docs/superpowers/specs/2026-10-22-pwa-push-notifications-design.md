# PWA push notifications: design

**Status:** asked for in chat on 22 October 2026 ("Can we make this app a PWA and add notifications? The notifications prompt needs to be pretty and friendly, and not annoying."). Each choice below was made by the operator in that conversation. This replaces the decision of 19 October to decline browser notifications: that was about tab-only notifications, which are useless on phones; Web Push arrives with the site closed.

## Intent

Residents want to know when the power goes off in Extension 16 and when it is back, without keeping the page open. The operator plans to share the site widely, so alerts are for any resident who opts in, not a private alert (that is the separate, on-hold Telegram work).

## Goals

- The site installs as a PWA (the manifest already exists) and can receive Web Push on Android, desktop browsers, and iPhone once added to the home screen (iOS 16.4+).
- Two notifications per outage: "off" and "back on", in the subscriber's language.
- A friendly, good-looking opt-in that never asks cold and never nags.
- Both languages; zero layout shift; no horizontal scroll at 320px.

## Non-goals

- Offline caching or any `fetch` handler in the service worker.
- Letting each subscriber choose which events they get.
- Telegram alerts (on hold).

## Anti-goals

- A phone buzzing "off" for a sensor connection blip: alerts wait `ALERT_DELAY_MS`.
- A stale or late alert: one-hour push TTL, a shared tag and topic so "back on" replaces "off", and queued sends dropped once past the TTL.
- Revealing how an outage was recorded, in notification text or anywhere else.
- Asking for permission on page load, or showing the card again after a "No thanks".
- Storing anything that identifies a visitor beyond the push subscription itself.

## What residents see

### Service worker

`public/sw.js` becomes a small static push-only worker, replacing the kill switch:

- `install` / `activate`: delete every cache (the job the kill switch does for browsers that ran the 17 to 18 October offline worker), `skipWaiting` and `clients.claim`. It no longer unregisters itself or reloads pages.
- `push`: show the notification in the payload (`title`, `body`, `tag`, `url`, `lang`) with the site icon and badge.
- `notificationclick`: focus an open window on the site, or open the payload's `url` (the page in the subscriber's language).
- No `fetch` handler, so it never answers a request from a cache. `/sw.js` keeps `Cache-Control: no-cache`.

The app registers it on the public pages only; `/admin` never registers it.

### The bell

An icon button in the header beside the language and theme toggles, the same size, so nothing moves. Its states:

- **Off:** opens the card.
- **On:** turns alerts off (unsubscribe and `DELETE` the subscription), with a short confirmation.
- **Blocked** (permission denied): explains how to allow notifications in the browser's settings.
- **Unsupported, or iPhone Safari not on the home screen:** opens the card in its install-first form.

Labels and `aria-pressed` reflect the state; copy is in both dictionaries.

### The card

A bottom sheet floating over the page (fixed position, so no layout shift), styled from `src/styles/palette.ts`, with a gentle entrance that respects `prefers-reduced-motion`. Focus moves to it when it opens, Escape closes it as "Not now".

Draft copy (final wording in `src/i18n`, Afrikaans first):

- Heading: "Want a heads-up?"
- Body: "Get a notification when the power goes off in Extension 16, and when it's back." A second line keeps the trust rule: the reading is one point in Extension 16, and some streets can differ.
- Buttons: **Turn on alerts**, **Not now**, **No thanks**.

Only **Turn on alerts** calls `Notification.requestPermission()`, so the browser's own prompt appears only after a tap.

When the card shows by itself:

- On a return visit (the visit count in `localStorage` is at least 2), a few seconds after the status has loaded.
- Never while the status is loading, and never to someone who is subscribed, blocked, unsupported (except the iPhone install case), or who chose No thanks.
- **Not now** hides it for 30 days; **No thanks** hides it for good. The bell always works.

Visit count, Not now and No thanks are new keys in `STORAGE_KEYS` (`src/lib/storage.ts`); storage being unavailable means the card simply may show again.

### iPhone

In Safari outside a home-screen app (`navigator.standalone` false, no `PushManager`), the card shows short steps instead of the button: tap Share, then Add to Home Screen, then open the site from there. It follows the same return-visit, Not now and No thanks rules as the normal card.

### Notifications

Draft text (from `src/i18n`, in the subscriber's locale):

- Off: "Power is off", "No power in Garsfontein Ext 16 since 14:02."
- Back on: "Power is back on", "Back at 16:15 after 2 h 13 min."
- Dismissed, for an outage alerted "off" and later found to be a false positive: "Power is on", "The earlier alert about Garsfontein Ext. 16 was not confirmed." It never says why or how.
- Planned outages use the calm planned wording: "Planned outage", "Started at 14:02, announced in advance."

All use one tag (`power`), so "back on" or "dismissed" replaces "off" in the tray. No text names or hints at the recording method.

## Server

### Keys

- VAPID key pair. The private key is a new Wrangler secret, `VAPID_PRIVATE_KEY` (JWK), added to `.dev.vars.example` in order, with a test key the e2e run uses.
- The public key is derived from the secret and served at `GET /api/push/key` (`PUSH_KEY_PATH`), so the test and production key pairs stay separate and no key is in the repo.
- `npm run vapid-keys` (`scripts/vapid-keys.ts`, WebCrypto only) prints a new pair.
- The VAPID `sub` claim is the site URL, keeping `CONTACT_EMAIL` secret.

### Endpoints

`PUSH_SUBSCRIPTION_PATH = '/api/push/subscription'` in `shared/paths.ts`:

- `POST`: body `{ endpoint, keys: { p256dh, auth }, locale }`, validated with Zod. Upserts on `endpoint`, so re-subscribing or changing language is idempotent. `204`.
- `DELETE`: body `{ endpoint }`. Deletes it if present. `204` either way.

Both use the default cross-site guard, a new `PUSH_LIMITER` rate limit, no `cors`, and no `purges` (no edge-cached view changes). Errors use codes in `shared/errors.ts`. Each gets a Bruno request with assertions.

**Push host allowlist:** `endpoint` must be `https:` on a known push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), kept as one `as const` list. Without it anyone could register a URL and have the Worker call it on every outage.

### Storage

Generated with `npm run db:generate`; both changes work with the old and the new code.

- New table `push_subscriptions`: `id` (integer primary key), `endpoint` (unique), `p256dh`, `auth`, `locale`, `created_at`. No IP, user agent or anything else about the visitor.
- New nullable columns on `outages`: `off_alert_at`, `on_alert_at`. They never appear in public responses or the CSV.

### Claiming alerts (minute cron)

After `detectOutage`, the minute cron calls one function that claims due alerts with conditional `UPDATE … RETURNING`, so overlapping runs never claim one twice:

- **Off:** an open outage, not a false positive, with no `off_alert_at`, that started at least `ALERT_DELAY_MS` (10 minutes, from `MINUTE_MS`) ago.
- **Back on:** a closed outage, not a false positive, with `off_alert_at` set and no `on_alert_at`.
- **Dismissed:** a false positive, open or closed, with `off_alert_at` set and no `on_alert_at`. It sets `on_alert_at` as well (the column records the one follow-up to "off"), so an outage gets "back on" or "dismissed", never both.

So an outage dismissed or closed within the delay never alerts in either direction; a backfilled closed outage never alerts; an outage open at deploy time sends one "off". A dismissal after "off" was sent sends one calm "dismissed" follow-up; a dismissal after "back on" sends nothing more. Claims run off, then back on, then dismissed, and a claim whose enqueue fails is released like the others.

### Sending (queue)

The cron never calls a push service. For each claimed alert it reads the subscription ids, splits them into pages of `PUSH_PAGE_SIZE` (40) and enqueues one message per page, `{ kind: 'off' | 'on' | 'dismissed', outageId, ids, attempt, queuedAt }`, with `sendBatch` (up to 100 messages per call).

The Worker's `queue` handler (`max_batch_size = 1`, so one page per invocation, under the Free plan's 50 outbound requests) for each message:

1. Loads the outage. Drops the message if an "off" outage is now a false positive or already closed, a "dismissed" outage is no longer a false positive, or if `queuedAt` is older than the push TTL.
2. Loads the page's subscriptions and builds each payload from `src/i18n` in the subscription's locale (the Worker imports the dictionaries).
3. Encrypts (RFC 8291, `aes128gcm`) and signs (VAPID, ES256) with `worker/lib/webpush.ts`, WebCrypto only, and POSTs with `TTL: 3600`, `Urgency: high` and `Topic: power`.
4. With `Promise.allSettled`: 404 or 410 deletes the subscription; 429 or 5xx collects the id for retry; anything else is logged.
5. Re-enqueues the failed ids with a delay and `attempt + 1`; after 3 attempts they are dropped. No dead-letter queue.

### Bindings

- `[[queues.producers]]` (`PUSH_QUEUE`) and `[[queues.consumers]]` in `wrangler.toml` at the top level and in `[env.e2e]` with its own queue name, and in `wrangler.example.toml`; the new `PUSH_LIMITER` with a unique `namespace_id` in all three. Then `npm run cf-typegen`.
- The production queue is created once with `wrangler queues create`; the README gives the step. Queues are on the Free plan.

## Privacy

`privacy.html` in both languages: what a push subscription is (an address at the browser's push service, not linked to a name or IP), what is stored (endpoint, keys, language, when), that the bell turns it off and deletes it, and that addresses the push service reports as gone are deleted automatically.

## Testing

Red first for each unit.

- **Crypto:** RFC 8291's published test vector for encryption; a VAPID JWT that verifies against the public key.
- **Worker (workerd, real D1, `test/helpers.ts`):**
  - Subscription endpoints: validation, the host allowlist, rate limit (`stubLimiter`), idempotent upsert, delete.
  - Claims: off only after `ALERT_DELAY_MS`; never for a false positive; back on only when off was sent; dismissed only for a false positive whose off was sent, and never alongside back on; no double claim; closed backfill never alerts; open-at-migration sends one off.
  - Consumer (push service mocked): 404/410 delete; 5xx re-enqueue with `attempt + 1`; drop after 3 attempts and past the TTL; a dismissed outage sends nothing; payload language follows the subscription.
- **Dictionaries:** the new strings are covered by the existing recording-method word check in `test/node/dictionaries.test.ts`.
- **e2e, both languages** (granted notification permission and a stubbed `PushManager`): the card appears only on a return visit; Not now and No thanks are respected; bell states; the iPhone install variant; `/admin` registers no service worker; zero layout shift and no horizontal scroll at 320px still hold.
- **CSP:** inline boot scripts are unchanged; `test/csp.test.ts` should still pass.

## Docs

README: the new endpoint in the API table, `VAPID_PRIVATE_KEY`, `PUSH_QUEUE` and `PUSH_LIMITER`, creating the queue and the VAPID keys. `privacy.html` as above.
