# PWA push notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Residents can opt in, through a friendly card or a header bell, to Web Push alerts when the power goes off in Extension 16 and when it is back.

**Architecture:** A push-only `public/sw.js` shows notifications. The app saves subscriptions through `/api/push/subscription` into D1. The minute cron claims due alerts on `outages` and enqueues pages of subscription ids on a Cloudflare Queue; the Worker's `queue` handler encrypts (RFC 8291) and signs (VAPID, RFC 8292) each push with WebCrypto and sends it.

**Tech Stack:** Solid, vanilla-extract, Cloudflare Workers, D1 with Drizzle, Cloudflare Queues, Vitest (workerd and Node), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-pwa-push-notifications-design.md`

## Global Constraints

- No new dependencies. Crypto is `crypto.subtle` only.
- `ALERT_DELAY_MS = 10 * MINUTE_MS`; push `TTL: 3600` (`PUSH_TTL_SECONDS`); `Urgency: high`; `Topic: power`; notification tag `power`.
- `PUSH_PAGE_SIZE = 40`; `sendBatch` at most 100 messages per call; consumer `max_batch_size = 1`; at most 3 attempts.
- Push host allowlist: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`; `https:` only.
- `push_subscriptions` stores only `endpoint`, `p256dh`, `auth`, `locale`, `created_at`. No IP, no user agent.
- `off_alert_at` / `on_alert_at` never appear in public responses or the CSV.
- The service worker has no `fetch` handler and creates no cache. `/admin` never registers it.
- The browser permission prompt appears only after a tap on **Turn on alerts**.
- Card: return visit only (visit count ≥ 2); Not now hides for 30 days (`30 * DAY_MS`); No thanks hides for good.
- All copy in `src/i18n/af.ts` (source) and `en.ts`. No word naming the recording method. Times are `site.timeZone`, `h23`.
- Constants as `as const` objects; durations from `MINUTE_MS`/`HOUR_MS`/`DAY_MS`. Commit summaries in Conventional Commits, lower case.
- Zero layout shift: every header button in the app has a disabled twin in the `index.html` shell.
- AGENTS.md hard rules apply: generated migrations only; new bindings at top level, in `[env.e2e]` and in `wrangler.example.toml`, then `npm run cf-typegen`; new secret in `.dev.vars.example` in order.

## Review Focus

1. **Language switch after subscribing:** alerts must follow the new language. Task 8 re-posts the subscription with the new locale on `switchLocale`.
2. **Permission revoked in browser settings:** the bell must show Blocked, not On, even if a subscription still exists. Task 9 derives state from `Notification.permission` first.
3. **Off and back on due in the same cron run** (an outage opened and closed while the cron was down for over ten minutes): each kind is claimed at most once, and "off" is enqueued before "back on". Task 5 tests this.
4. **Re-subscribing from a second tab, or unsubscribing an unknown endpoint:** no error, one row. Task 3 tests this.
5. **The Worker runs in UTC:** notification times must be in `site.timeZone`. Task 4 tests a fixed instant.

---

### Task 1: Web Push crypto and VAPID keys

**Files:**
- Create: `worker/lib/webpush.ts`, `scripts/vapid-keys.ts`, `test/webpush.test.ts`
- Modify: `.dev.vars.example` (add `VAPID_PRIVATE_KEY` with a test-only JWK, in order), `vitest.config.ts` (`VAPID_PRIVATE_KEY` binding, the same test key), `package.json` (`"vapid-keys": "node scripts/vapid-keys.ts"`)

**Interfaces:**
- Produces:
  - `interface PushTarget { endpoint: string; p256dh: string; auth: string }` (keys base64url)
  - `encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>, fixed?: { salt: Uint8Array; serverKeys: CryptoKeyPair }): Promise<Uint8Array>` (the `aes128gcm` body: header with salt, rs 4096, keyid = server public key, then the single record)
  - `vapidPublicKey(privateJwk: JsonWebKey): string` (base64url uncompressed point `0x04‖x‖y`, from the JWK's `x` and `y`)
  - `vapidAuthorization(endpoint: string, privateJwk: JsonWebKey, now: number): Promise<string>` (returns `vapid t=<jwt>, k=<vapidPublicKey(privateJwk)>`; claims `aud` = endpoint origin, `exp` = now + 12 h in seconds, `sub` = `site.url`)
  - `buildPushRequest(target: PushTarget, payload: object, privateJwk: JsonWebKey, now: number): Promise<Request>` (POST, headers `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`, `TTL: 3600`, `Urgency: high`, `Topic: power`, `Authorization`)
  - `PUSH_TTL_SECONDS = 3600`

- [ ] **Step 1: Write the failing tests** in `test/webpush.test.ts`:
  - `encrypts RFC 8291's example exactly`: with the inputs from RFC 8291 Appendix A (plaintext "When I grow up, I want to be a watermelon", the receiver's `p256dh` and `auth`, the sender's key pair imported from the appendix as an ECDH key pair, and the salt), `encryptPayload` returns the appendix's encrypted body byte for byte (compare base64url strings).
  - `signs a VAPID token the public key verifies`: decode the JWT from `vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', testJwk, now)`; header `{ typ: 'JWT', alg: 'ES256' }`; claims `aud === 'https://fcm.googleapis.com'`, `sub === site.url`, `exp === Math.floor(now / 1000) + 12 * 3600`; `crypto.subtle.verify` (ECDSA P-256, SHA-256) with the key from `vapidPublicKey(testJwk)` returns true; `k=` equals `vapidPublicKey(testJwk)`.
  - `builds a push request with the delivery headers`: `buildPushRequest` sets the six headers above, URL equals the endpoint, body length > 86.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run --project worker test/webpush.test.ts`
  Expected: FAIL, cannot resolve `../worker/lib/webpush`.

- [ ] **Step 3: Write `scripts/vapid-keys.ts`.** It generates an ECDSA P-256 pair and prints the private key as a one-line JWK, for `wrangler secret put VAPID_PRIVATE_KEY`. Run it once for a test-only JWK in `.dev.vars.example` and `vitest.config.ts`. The public key is never stored: the Worker derives it from the secret and serves it (Task 3), so test and production keys stay separate and nothing secret is in the repo.

- [ ] **Step 4: Implement `worker/lib/webpush.ts`** per RFC 8291 section 3.3 to 3.4 and RFC 8188 (HKDF-SHA-256 for `auth_info`/`cek_info`/`nonce_info`; one record with delimiter `0x02` and no padding) and RFC 8292 (JWS ES256; WebCrypto's raw r‖s signature is the JWS form). Fresh salt (16 random bytes) and ECDH key pair unless `fixed` is passed.

- [ ] **Step 5: Run the tests and verify they pass**
  Run: `npx vitest run --project worker test/webpush.test.ts`
  Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
  `git commit -m "feat: encrypt and sign web push messages"` with the files above.

---

### Task 2: Subscriptions table and alert columns

**Files:**
- Modify: `worker/db/schema.ts`, `test/setup.ts` (add `push_subscriptions` to `TABLES`)
- Create: `drizzle/00NN_push_subscriptions.sql` (via `npm run db:generate`), test in `test/push.test.ts` (created here, extended in Task 3)

**Interfaces:**
- Produces: `pushSubscriptions` table (`id` integer primary key autoincrement, `endpoint` text unique not null, `p256dh` text not null, `auth` text not null, `locale` text enum `site.locales` not null, `createdAt` text not null); `outages.offAlertAt` and `outages.onAlertAt` (nullable text, ISO). Type `PushSubscriptionRow = typeof pushSubscriptions.$inferSelect`.

- [ ] **Step 1: Write the failing test** `keeps alert times out of the public views`: insert an outage, set `off_alert_at` with raw SQL, then assert the `/api/status` outage object, `/api/outages` and the CSV header contain no key or column matching `/alert/i`.
- [ ] **Step 2: Run it** (`npx vitest run --project worker test/push.test.ts`). Expected: FAIL, no such column `off_alert_at`.
- [ ] **Step 3: Add the table and columns to `schema.ts`**, with one-line comments (what `null` means for each column). Run `npm run db:generate`, then read the SQL. It must be `CREATE TABLE`, a unique index and two `ALTER TABLE … ADD`, with no table rebuild. Run `npm run db:migrate:local`.
- [ ] **Step 4: Run the test.** Expected: PASS. Then run `npx vitest run --project worker` (all pass).
- [ ] **Step 5: Commit** `feat: store push subscriptions and alert times` (schema, `drizzle/`, setup, test).

---

### Task 3: Subscription endpoints

**Files:**
- Create: `worker/routes/push.ts`, `bruno/public/push-subscribe.bru`, `bruno/public/push-unsubscribe.bru` (follow the folder and style of the existing contact request)
- Modify: `shared/paths.ts` (`PUSH_SUBSCRIPTION_PATH = '/api/push/subscription'`, `PUSH_KEY_PATH = '/api/push/key'`), `worker/routes/index.ts`, `wrangler.toml` + `[env.e2e]` + `wrangler.example.toml` (`PUSH_LIMITER` rate limit, unique `namespace_id`, same limit and period as `CONTACT_LIMITER`), `worker/worker-configuration.d.ts` (`npm run cf-typegen`), `test/push.test.ts`, `README.md` (API table)

**Interfaces:**
- Consumes: `pushSubscriptions` (Task 2).
- Produces: `PUSH_SUBSCRIPTION_PATH`; `PUSH_KEY_PATH` (GET returns `{ publicKey }` from `vapidPublicKey(JSON.parse(env.VAPID_PRIVATE_KEY))`, `Cache-Control` from `publicCache(DAY_MS)`, `limiter: 'STATUS_LIMITER'`, 404 `notConfigured` when the secret is unset); `PUSH_HOSTS` and `isPushEndpoint(url: string): boolean` exported from `worker/routes/push.ts`; request body `{ endpoint, keys: { p256dh, auth }, locale }` for POST, `{ endpoint }` for DELETE; both answer `204`.

- [ ] **Step 1: Write the failing tests** in `test/push.test.ts`:
  - `saves a subscription`: POST a valid body (endpoint `https://fcm.googleapis.com/fcm/send/abc`, locale `'af'`). Expect 204 and one row with those values.
  - `updates rather than duplicates on re-subscribe`: POST the same endpoint twice, the second with `'en'`. Expect one row with locale `en`.
  - `refuses endpoints off the push host list`: each of `http://fcm.googleapis.com/x`, `https://example.com/x`, `https://fcm.googleapis.com.evil.com/x` and `https://push.apple.com.evil/x` gets 400 and no row. `https://web.push.apple.com/x` and `https://wns2-par02p.notify.windows.com/x` get 204.
  - `refuses a bad body`: a missing `keys.auth`, a locale `'fr'`, or an endpoint over 2048 characters all get 400.
  - `deletes a subscription, known or not`: DELETE a saved endpoint gives 204 and zero rows. DELETE an unknown one gives 204.
  - `is rate limited`: with `stubLimiter()` passed in `env`, POST gives 429.
  - `serves the public key`: GET `PUSH_KEY_PATH` gives 200 and `{ publicKey: vapidPublicKey(testJwk) }`. With `VAPID_PRIVATE_KEY` unset in `env`, it gives 404.
  - `refuses cross-site requests`: POST with `Origin: https://evil.example` gives 403 (match whatever the existing cross-site test asserts).
- [ ] **Step 2: Run them.** Expected: FAIL (404).
- [ ] **Step 3: Implement `worker/routes/push.ts`** following `worker/routes/contact.ts`: Zod schemas (`endpoint` string url max 2048 refined by `isPushEndpoint`; keys base64url strings max 256; `locale: z.enum(site.locales)`), an upsert `onConflictDoUpdate` on `endpoint`, and `limiter: 'PUSH_LIMITER'`, with no `cors` and no `purges`. `isPushEndpoint` parses the URL, requires `https:`, and matches the hostname exactly or as a `.`-suffix for the wildcard entries. Add the bindings and run `npm run cf-typegen`. Add the Bruno requests (status 204), and README API table rows saying what is stored.
- [ ] **Step 4: Run them.** Expected: PASS. Also run `npx vitest run --project worker test/edge-cache.test.ts` (PASS).
- [ ] **Step 5: Commit** `feat: add push subscription endpoint`.

---

### Task 4: Alert copy and message builder

**Files:**
- Create: `worker/lib/alerts.ts`, `test/alerts.test.ts`
- Modify: `src/i18n/af.ts`, `src/i18n/en.ts` (new `push` section), `tsconfig.worker.json` (include `src/i18n` and `site.config.ts`, which the dictionaries import)

**Interfaces:**
- Produces:
  - `ALERT_KINDS = ['off', 'on'] as const; type AlertKind`
  - `interface AlertPayload { title: string; body: string; tag: 'power'; url: string; lang: Locale }`
  - `alertMessage(kind: AlertKind, outage: Pick<Outage, 'startTime' | 'endTime' | 'isPlanned'>, locale: Locale): AlertPayload`. `url` is `site.url + '/'` for the default locale and `site.url + '/en/'` otherwise; reuse the existing locale path helper in `shared/locale.ts` if there is one.
  - Dictionary `push` section, the Afrikaans shape mirrored in English:
    - `push.off: { title: string; body: (time: string) => string }`
    - `push.planned: { title: string; body: (time: string) => string }`
    - `push.on: { title: string; body: (time: string, duration: string) => string }`
  - English copy from the spec: "Power is off" / "No power in Garsfontein Ext 16 since 14:02."; "Planned outage" / "Started at 14:02, announced in advance."; "Power is back on" / "Back at 16:15 after 2 h 13 min."

- [ ] **Step 1: Write the failing tests** in `test/alerts.test.ts`, taking expected copy from `DICTIONARIES` and not literals, apart from one smoke string per language:
  - `says when the power went off, in local time`: `startTime '2026-10-22T12:02:00Z'`, locale `en`. The body equals `en.push.off.body('14:02')` and contains `14:02`.
  - `uses the planned wording for planned outages`: with `isPlanned: true`, the title is `push.planned.title`.
  - `says when it came back and for how long`: start `12:02Z`, end `14:15Z`. The `en` body equals `en.push.on.body('16:15', '2 h 13 min')`.
  - `speaks the subscriber's language`: with locale `af`, the title equals `af.push.off.title` and the `url` ends with `/`. With `en`, the `url` ends with `/en/`.
  - `uses one tag`: `tag === 'power'` for both kinds.
  - Run the existing dictionaries test unchanged; it covers the new strings for banned words.
- [ ] **Step 2: Run them.** Expected: FAIL (module not found).
- [ ] **Step 3: Add the copy** to `af.ts` (natural Afrikaans, for example "Die krag is af" / "Geen krag in Garsfontein Uitb. 16 sedert 14:02 nie.") and to `en.ts`. Implement `alertMessage` with an `Intl.DateTimeFormat(site.intlLocales[locale], { timeZone: site.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`, and a duration built from the dictionary's `units` (`h`, `min`). Short outages show minutes only.
- [ ] **Step 4: Run them**, then `npm run typecheck` and `npx vitest run --project node test/node/dictionaries.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: write push alert messages in both languages`.

---

### Task 5: Claim due alerts and enqueue them

**Files:**
- Modify: `worker/lib/alerts.ts`, `worker/index.ts` (minute cron), `wrangler.toml` + `[env.e2e]` + `wrangler.example.toml` (`[[queues.producers]] binding = "PUSH_QUEUE"`, queue `lights-on-push` / `lights-on-push-e2e`; `[[queues.consumers]]` with `max_batch_size = 1`, `max_retries = 0`), `worker/worker-configuration.d.ts`, `test/helpers.ts` (`runCron` gains an optional `env` argument), `test/alerts.test.ts`

**Interfaces:**
- Consumes: `outages.offAlertAt/onAlertAt`, `pushSubscriptions` (Task 2), `AlertKind` (Task 4).
- Produces:
  - `ALERT_DELAY_MS = 10 * MINUTE_MS`, `PUSH_PAGE_SIZE = 40`, `PUSH_MAX_ATTEMPTS = 3`
  - `interface AlertClaim { kind: AlertKind; outageId: number }`
  - `interface AlertPage extends AlertClaim { ids: number[]; attempt: number; queuedAt: string }` (the queue message body)
  - `claimAlerts(db: Db, now: Date): Promise<AlertClaim[]>` (all "off" claims before "on" claims)
  - `enqueueAlerts(db: Db, queue: Queue<AlertPage>, claims: AlertClaim[], now: Date): Promise<void>`

- [ ] **Step 1: Write the failing tests** in `test/alerts.test.ts`. Use a stub queue `{ sendBatch: vi.fn() }`, and call `claimAlerts` and `enqueueAlerts` directly with `createDb(env.DB)`, plus one test through `runCron(MINUTE_CRON, now, { ...env, PUSH_QUEUE: stub })`:
  - `claims off once the outage is ALERT_DELAY_MS old`: an open outage started 9 min ago gives `[]`. At 10 min it gives `[{ kind: 'off', outageId }]`, and `off_alert_at` is set.
  - `claims each alert once`: two `claimAlerts` calls in a row; the second returns `[]`. Also two concurrent calls (`Promise.all`) yield a single claim in total.
  - `never claims a false positive`: an open outage with `is_false_positive = 1` gives `[]`.
  - `claims back on only after off was sent`: a closed outage with `off_alert_at` set gives `[{ kind: 'on' }]`. A closed outage without `off_alert_at` (closed inside the delay, or backfilled) gives `[]`.
  - `claims off and back on in one run, off first` (Review Focus 3): outage A open for 10 min, outage B closed with `off_alert_at` set. The kinds come back as `['off', 'on']`.
  - `enqueues pages of PUSH_PAGE_SIZE`: with 85 subscriptions, `sendBatch` receives 3 messages, with `ids` lengths 40, 40 and 5, `attempt: 1`, and `queuedAt` equal to `now`. With 0 subscriptions, `sendBatch` is not called.
  - `splits sendBatch at 100 messages`: with 4,001 subscriptions (insert with one batched statement), there are 2 calls, of 100 and 1 messages.
  - `the minute cron enqueues due alerts`: through `runCron` with the stub env, `sendBatch` is called.
- [ ] **Step 2: Run them.** Expected: FAIL (not exported).
- [ ] **Step 3: Implement.** Each claim is one `UPDATE outages SET off_alert_at = ? WHERE … RETURNING id`, so the update is the lock. Off claims need: `end_time IS NULL`, not a false positive, `off_alert_at IS NULL`, and `start_time <= now - ALERT_DELAY_MS`. On claims need: `end_time IS NOT NULL`, not a false positive, `off_alert_at IS NOT NULL`, and `on_alert_at IS NULL`. `enqueueAlerts` selects only `id` from `push_subscriptions` ordered by `id`. In `worker/index.ts`, the minute branch runs `detectOutage` and its purge as now, then `enqueueAlerts(db, env.PUSH_QUEUE, await claimAlerts(db, now), now)`. Add the bindings and run `npm run cf-typegen`. The README gets the `wrangler queues create lights-on-push` step.
- [ ] **Step 4: Run them**, then the full worker project. Expected: PASS (including `test/scheduled.test.ts` unchanged).
- [ ] **Step 5: Commit** `feat: claim due power alerts and queue them for sending`.

---

### Task 6: Queue consumer

**Files:**
- Modify: `worker/lib/alerts.ts` (or create `worker/lib/deliver.ts` if `alerts.ts` passes about 200 lines), `worker/index.ts` (`queue` handler), `test/alerts.test.ts`

**Interfaces:**
- Consumes: `buildPushRequest`, `PUSH_TTL_SECONDS` (Task 1); `alertMessage` (Task 4); `AlertPage`, `PUSH_MAX_ATTEMPTS` (Task 5).
- Produces: `deliverAlertPage(page: AlertPage, env: Env, now: Date): Promise<void>`. The `queue(batch, env)` handler calls it for each message, then `ack`s it.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` for push hosts in the style of `mockSiteverify`, using a host-matching helper `mockPushService(statusFor: (endpoint: string) => number)` added to `test/helpers.ts`. Pass a stub `PUSH_QUEUE` via `env`.
  - `sends one push per subscription on the page`: 3 subscriptions, all answering 201. 3 fetches are made, each a POST to its endpoint with `Topic: power`.
  - `writes each push in its subscriber's language`: with one `af` and one `en` subscription, a `vi.spyOn` on `alertMessage` sees one call with each locale.
  - `deletes subscriptions the push service says are gone`: 404 and 410 rows are deleted; a 201 row stays.
  - `re-queues only transient failures`: with 201, 429 and 503, `PUSH_QUEUE.send` is called once with `{ ids: [the 429 and 503 ids], attempt: 2 }` and `delaySeconds > 0`.
  - `gives up after PUSH_MAX_ATTEMPTS`: on attempt 3, a 503 re-queues nothing.
  - `drops a page older than the push TTL`: `queuedAt` is `now - (PUSH_TTL_SECONDS + 1) s`, so 0 fetches.
  - `drops an off alert for an outage dismissed meanwhile`: the outage was marked a false positive after the claim, so 0 fetches. The same applies to an "off" page whose outage has since closed.
  - `skips ids that no longer exist`: a page listing a deleted id sends only to the rest.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `deliverAlertPage`, following the order in the spec (Sending, steps 1 to 5). `JSON.parse(env.VAPID_PRIVATE_KEY)` happens once per call. Use `Promise.allSettled`. A rejected fetch counts as transient. The re-queue delay is `60 * attempt` seconds. Log other statuses with `console.warn`, giving the status and the push host but never the endpoint path. Add the `queue` export to `worker/index.ts`, beside `scheduled`, and type it with `ExportedHandler<Env, AlertPage>`.
- [ ] **Step 4: Run them**, then the full worker project and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: deliver queued power alerts`.

---

### Task 7: Push-only service worker

**Files:**
- Modify: `public/sw.js`, `public/_headers` (keep the `no-cache` and update the comment if it cites the kill switch)
- Create: `test/node/sw.test.ts`

**Interfaces:**
- Consumes: the `AlertPayload` shape (Task 4) as the push data.
- Produces: a service worker at `/sw.js` with `install`, `activate`, `push` and `notificationclick` listeners only.

- [ ] **Step 1: Write the failing tests** in `test/node/sw.test.ts`. Evaluate `public/sw.js` with `node:vm` against a fake `self` that records `addEventListener` calls, a fake `caches` with `keys` and `delete`, a `registration.showNotification` spy and a `clients` stub:
  - `handles only install, activate, push and notificationclick`: the listener names equal exactly those four (no `fetch`).
  - `deletes every cache on activate`: with caches `['old-shell', 'old-data']`, both are deleted after the `waitUntil` promise. The worker does not unregister.
  - `shows the pushed notification`: a push event whose `data.json()` is an `AlertPayload` leads to `showNotification(title, { body, tag: 'power', lang, icon: '/icon-192.png', badge: '/icon-192.png', data: { url } })`.
  - `focuses an open page or opens the alert's page on click`: with one window client, `focus` is called and `openWindow` is not. With none, `openWindow(url)` is called.
- [ ] **Step 2: Run them** (`npx vitest run --project node test/node/sw.test.ts`). Expected: FAIL (the kill switch has no push listener).
- [ ] **Step 3: Rewrite `public/sw.js`** as plain JS with no imports. The header comment says why it has no fetch handler (a stale status must never be served as live) and why `activate` still clears caches (the 17 to 18 October offline worker).
- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run --project node test/node/dist.test.ts` after `npm run build` (PASS).
- [ ] **Step 5: Commit** `feat: replace the kill switch with a push-only service worker`.

---

### Task 8: Client push library and card rules

**Files:**
- Create: `src/lib/push.ts`, `test/node/push.test.ts`
- Modify: `src/lib/storage.ts` (`STORAGE_KEYS.visits`, `.alertsSnoozedUntil`, `.alertsDeclined`), `src/index.tsx` (register `/sw.js` on public pages only, count the visit), `src/lib/i18n.ts` (`switchLocale` re-saves an existing subscription)

**Interfaces:**
- Consumes: `PUSH_SUBSCRIPTION_PATH` and `PUSH_KEY_PATH` (Task 3).
- Produces:
  - `type PushSupport = 'supported' | 'ios-install' | 'unsupported'`; `pushSupport(env = { window, navigator }): PushSupport`. `'ios-install'` means an iOS user agent, not standalone, and no `PushManager`.
  - `type AlertsState = 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported'`; `alertsState(): Promise<AlertsState>`. `Notification.permission === 'denied'` gives `'blocked'` before any subscription check.
  - `turnOnAlerts(locale: Locale): Promise<AlertsState>` (request permission, fetch `PUSH_KEY_PATH`, subscribe with it as `applicationServerKey`, POST)
  - `turnOffAlerts(): Promise<void>` (unsubscribe, DELETE)
  - `resaveAlerts(locale: Locale): Promise<void>` (POSTs only if a subscription exists)
  - `shouldOfferCard(input: { visits: number; snoozedUntil: number | null; declined: boolean; state: AlertsState; now: number }): boolean`
  - `ALERTS_SNOOZE_MS = 30 * DAY_MS`

- [ ] **Step 1: Write the failing tests** in `test/node/push.test.ts` (pure functions):
  - `shouldOfferCard`: visits 1 gives false. Visits 2 with state `off` gives true. State `ios-install` gives true. States `on`, `blocked` and `unsupported` give false. `declined` gives false. Snoozed until `now + 1` gives false, and until `now - 1` gives true.
  - `pushSupport`: an iPhone UA that is not standalone and has no `PushManager` gives `'ios-install'`. An iPhone in standalone mode with `PushManager` gives `'supported'`. A desktop with no `serviceWorker` gives `'unsupported'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `src/lib/push.ts`, then wire it in:**
  - Pass browser objects in as parameters with defaults, so Node tests need no DOM.
  - `src/index.tsx` registers `/sw.js` and increments `visits` once per page load, but only when the page is not `ADMIN_PAGE_PATH`.
  - `switchLocale` calls `resaveAlerts(next)` and doesn't wait for it to finish.
  - Storage keys go in `STORAGE_KEYS`, each with a one-line comment.
- [ ] **Step 4: Run them**, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: subscribe to power alerts from the browser`.

---

### Task 9: Bell and card

**Files:**
- Create: `src/components/AlertsBell.tsx`, `src/components/AlertsCard.tsx`, `src/components/AlertsCard.css.ts`, `e2e/alerts.spec.ts`
- Modify: `src/App.tsx` (bell in `gg-masthead-actions` before `LanguageToggle`, public only; card mounted once on public pages), `index.html` (a disabled `gg-icon-button` with `data-i18n-label="alerts.bell.label"` in the shell's masthead actions, in the same position), `src/i18n/af.ts` + `en.ts` (`alerts` section), `e2e/fixtures.ts` (if a helper is needed for the push stub)

**Interfaces:**
- Consumes: everything in Task 8.
- Produces: the dictionary `alerts` section, which has:
  - `bell: { label, on, off, blocked, install }`
  - `card: { heading, body, scope, turnOn, notNow, noThanks, iosSteps: string[], blockedHelp, turnedOn, turnedOff }`

  The English copy matches the spec: "Want a heads-up?"; "Get a notification when the power goes off in Extension 16, and when it's back."; the scope line; **Turn on alerts**, **Not now**, **No thanks**.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/alerts.spec.ts`, for both languages (`test.use({ appLocale: 'af' })` in a second describe), with `context.grantPermissions(['notifications'])`. Use `page.addInitScript` to stub `PushManager.prototype.subscribe`/`getSubscription` with a fake FCM endpoint, and `page.route` to record calls to `PUSH_SUBSCRIPTION_PATH`. Take copy from the dictionaries.
  - `does not offer alerts on a first visit`: the card is not visible after the status loads and 4 s pass (use `expect(...).not.toBeVisible()` with a poll, not a fixed wait).
  - `offers alerts on a return visit and subscribes on tap`: reload, the card appears, tap Turn on. POST is called with `locale` equal to the page's locale, the card closes, and the bell's `aria-pressed` is `true`.
  - `Not now hides the card for the snooze period`: tap Not now and reload, and the card is hidden. Set `alertsSnoozedUntil` in the past and reload, and it shows.
  - `No thanks hides the card for good, and the bell still works`: tap No thanks and reload, and it is hidden. Tap the bell, and the card opens.
  - `turning off from the bell unsubscribes`: when on, tapping the bell sends DELETE and sets `aria-pressed="false"`.
  - `blocked permission shows help`: with permissions cleared and `Notification.permission` stubbed to `'denied'`, the bell opens the card with `blockedHelp`.
  - `iPhone Safari shows install steps`: with an iPhone UA and no `PushManager`, the card lists `iosSteps` and has no Turn on button.
  - `admin registers no service worker`: on `/admin`, `navigator.serviceWorker.getRegistrations()` is empty.
  - Extend the existing layout-shift and 320px tests (`e2e/app.spec.ts`) so they still pass with the bell. The card being visible must not change CLS.
- [ ] **Step 2: Run them** (`npm run test:e2e -- e2e/alerts.spec.ts`). Expected: FAIL (no bell).
- [ ] **Step 3: Implement the components:**
  - **Bell:** in the style of `ThemeToggle` (`gg-icon-button`, lucide `Bell` / `BellOff` / `BellRing` icons, `aria-pressed`, `title`).
  - **Card:**
    - Layout: a `position: fixed` bottom sheet, `role="dialog"` with `aria-labelledby`, focus moved to its heading on open, and Escape meaning Not now.
    - Look: colours from `palette.ts`; a slide and fade entrance wrapped in `@media (prefers-reduced-motion: no-preference)`.
    - Width: `max-width` and `inset-inline` that fit 320px.
    - When it appears on its own: `shouldOfferCard`, 3 s after the status first resolves.
  - **Shell:** the `index.html` placeholder button. If the shell's i18n test asserts the button count, update that test too.
- [ ] **Step 4: Run them**, then all of `npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: offer power alerts with a bell and a friendly card`.

---

### Task 10: Privacy page, README and the full definition of done

**Files:**
- Modify: `privacy.html` (both language sections), `README.md`, `.dev.vars.example` (already done in Task 1; check the order)

- [ ] **Step 1: Write the privacy text** in both languages:
  - What a push subscription is: an address at the browser's push service, not linked to a name or IP.
  - What is stored: the endpoint, the keys, the language, and when it was saved.
  - That turning alerts off deletes it, and that addresses the push service reports as gone are deleted automatically.
  - Which push services are involved: Google, Mozilla, Apple, Microsoft.
- [ ] **Step 2: Update the README.** Cover:
  - The endpoint rows (already added in Task 3).
  - Secrets: `VAPID_PRIVATE_KEY`.
  - Bindings: `PUSH_QUEUE`, `PUSH_LIMITER`.
  - Setup: `npm run vapid-keys`, `wrangler secret put VAPID_PRIVATE_KEY`, `wrangler queues create lights-on-push`.
  - A short "Notifications" behaviour note: the alert delay by name (`ALERT_DELAY_MS`), off and back on, and the TTL.
- [ ] **Step 3: Run the definition of done in order:**
  `npm run lint:ci && npm run typecheck && npm run build && CHECK_DIST=1 npm test && npm run test:e2e`
  Expected: every command exits 0. On Windows, a 0xC0000409 or EPERM e2e crash gets one rerun (a known local flake); report it if it persists.
- [ ] **Step 4: Commit** `docs: explain push alerts in the readme and privacy page`.
