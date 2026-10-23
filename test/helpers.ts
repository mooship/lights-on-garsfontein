import { createScheduledController, env } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import {
  MINUTE_MS,
  type OutageSource,
  type StatusResponse,
  TURNSTILE_ACTION,
  type TurnstileAction,
} from '../shared/api';
import { HEARTBEAT_PATH, HEARTBEAT_PAUSE_PATH, LOGIN_PATH, STATUS_PATH } from '../shared/paths';
import { MINUTE_CRON } from '../worker/crons';
import worker from '../worker/index';
import { SESSION_COOKIE } from '../worker/lib/cookies';
import { randomToken, sha256Hex } from '../worker/lib/crypto';
import { CLIENT_IP_HEADER } from '../worker/lib/http';
import { routes } from '../worker/routes';
import { ADMIN_USER_ID, passwordFingerprint, SESSION_TTL_MS } from '../worker/routes/auth';
import { RFC8291_RECEIVER_KEYS } from './push-keys';

/** The test SITE_URL (set once in vitest.config.ts). */
export const ORIGIN = env.SITE_URL;

/** The path of every route with `edgeCache`; test/setup.ts empties their cached copies before each test. */
export const EDGE_CACHED = Object.entries(routes)
  .filter(([, route]) => route.edgeCache)
  .map(([key]) => key.slice(key.indexOf(' ') + 1));

/**
 * A rate-limit binding that refuses (or, with `success`, allows) every request, to pass in
 * `call`'s `env`; its `limit` is a spy, so a test can check the key it was asked about.
 */
export function stubLimiter(success = false) {
  return { limit: vi.fn(async (_options: RateLimitOptions) => ({ success })) };
}

let ipCounter = 0;
/** A fresh client IP so rate-limit buckets never leak between tests. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

interface CallOptions {
  method?: string;
  /** Sent as JSON; `rawBody` is sent as is. Either way Content-Type defaults to application/json. */
  body?: unknown;
  rawBody?: string;
  ip?: string;
  cookie?: string;
  headers?: Record<string, string>;
  env?: Env;
}

/** Sends a request through the Worker's fetch handler, from a fresh uniqueIp() unless `ip` is given. */
export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set(CLIENT_IP_HEADER, options.ip ?? uniqueIp());
  if (options.cookie) headers.set('Cookie', options.cookie);
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const request = new Request(`${ORIGIN}${path}`, { method: options.method ?? 'GET', headers, body });
  return worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, options.env ?? env);
}

/**
 * Stubs fetch for `hostname`, which `answer`s with the request's URL; other fetches go through.
 * Like a real fetch, it rejects once its signal has aborted. Returns the spy.
 */
export function stubFetchHost(hostname: string, answer: (url: string) => Response | Promise<Response>) {
  const realFetch = globalThis.fetch;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname !== hostname) return realFetch(input, init);
    (init?.signal ?? (input instanceof Request ? input.signal : null))?.throwIfAborted();
    return answer(url);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Makes every `AbortSignal.timeout` fire at once, so a fetch stubbed with stubFetchHost fails as a timed-out one does. */
export function expireTimeouts() {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
    AbortSignal.abort(new DOMException('The operation timed out', 'TimeoutError')),
  );
}
/** Stubs the Turnstile siteverify call with `answer`; other fetches go through. */
export const mockSiteverify = (answer: () => Response | Promise<Response>) =>
  stubFetchHost('challenges.cloudflare.com', answer);

/** The host of the subscriptions `insertSubscription` writes, and the one `mockPushService` answers for. */
export const PUSH_TEST_HOST = 'push.example';

/** Writes a subscription straight to D1 and returns its id; `name` makes its endpoint unique. */
export async function insertSubscription(name: string, locale: 'af' | 'en' = 'en'): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint, p256dh, auth, locale, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(
      `https://${PUSH_TEST_HOST}/${name}`,
      RFC8291_RECEIVER_KEYS.p256dh,
      RFC8291_RECEIVER_KEYS.auth,
      locale,
      '2026-10-22T12:00:00.000Z',
    )
    .first<{ id: number }>();
  if (!row) throw new Error('insert failed');
  return row.id;
}

/** Stubs the push service at `PUSH_TEST_HOST`: it answers with `statusFor(endpoint)`, or rejects if that is an `Error`. */
export const mockPushService = (statusFor: (endpoint: string) => number | Error) =>
  stubFetchHost(PUSH_TEST_HOST, (url) => {
    const answer = statusFor(url);
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer });
  });

/** Stubs the Turnstile siteverify call: a token solved on our host for `action`. */
export function mockTurnstile(
  success: boolean,
  action: TurnstileAction = TURNSTILE_ACTION.contact,
  hostname = new URL(ORIGIN).hostname,
) {
  return mockSiteverify(() => Response.json({ success, action, hostname }));
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await call(STATUS_PATH);
  expect(res.status).toBe(200);
  return res.json();
}

/** Writes the sensor's last heartbeat straight to D1, `secondsAgo` in the past; returns it as ISO. */
export async function setHeartbeat(secondsAgo: number): Promise<string> {
  const lastSeen = new Date(Date.now() - secondsAgo * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO heartbeats (id, last_seen) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen',
  )
    .bind(lastSeen)
    .run();
  return lastSeen;
}

/**
 * Writes an outage straight to D1, so nothing purges the edge cache; by default an open sensor outage.
 * `offAlertAt` and `onAlertAt` seed alerts as already claimed.
 */
export async function insertOutage(values: {
  startTime?: string;
  endTime?: string | null;
  source?: OutageSource;
  isFalsePositive?: 0 | 1;
  isPlanned?: 0 | 1;
  offAlertAt?: string;
  onAlertAt?: string;
}): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO outages (start_time, end_time, source, is_false_positive, is_planned, off_alert_at, on_alert_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(
      values.startTime ?? new Date(Date.now() - 10 * MINUTE_MS).toISOString(),
      values.endTime ?? null,
      values.source ?? 'sensor',
      values.isFalsePositive ?? 0,
      values.isPlanned ?? 0,
      values.offAlertAt ?? null,
      values.onAlertAt ?? null,
    )
    .first<{ id: number }>();
  if (!row) throw new Error('insert failed');
  return row.id;
}

/**
 * A signed-in admin's cookie without going through the login route, whose site-wide limit
 * (LOGIN_GLOBAL_LIMITER) a test file would otherwise use up. The row is the one login writes.
 */
export async function createSession({
  createdAt = Date.now(),
  expiresAt = createdAt + SESSION_TTL_MS,
}: {
  createdAt?: number;
  expiresAt?: number;
} = {}): Promise<string> {
  const token = randomToken();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at, password_fingerprint) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256Hex(token),
      ADMIN_USER_ID,
      new Date(expiresAt).toISOString(),
      new Date(createdAt).toISOString(),
      await passwordFingerprint(env),
    )
    .run();
  return `${SESSION_COOKIE}=${token}`;
}

/** The password whose hash is ADMIN_PASSWORD_HASH in vitest.config.ts. */
export const ADMIN_PASSWORD = 'test-password';

/** One sign-in attempt as the admin user, whatever its answer; the caller mocks Turnstile. */
export function loginAttempt(password: string, options: CallOptions = {}): Promise<Response> {
  return call(LOGIN_PATH, {
    method: 'POST',
    body: { username: env.ADMIN_USERNAME, password, token: 'turnstile-token' },
    ...options,
  });
}

/** Signs in through the login route; prefer createSession unless the test is about signing in. */
export async function login(password = ADMIN_PASSWORD): Promise<string> {
  mockTurnstile(true, TURNSTILE_ACTION.login);
  const res = await loginAttempt(password);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

/** A sensor heartbeat with the right token. */
export function heartbeat(options: CallOptions = {}): Promise<Response> {
  return call(HEARTBEAT_PATH, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.HEARTBEAT_TOKEN}` },
    ...options,
  });
}

/** The sensor pausing outage detection until `until`, or ending its pause with null. */
export function requestPause(until: string | null, token = env.HEARTBEAT_TOKEN): Promise<Response> {
  return call(HEARTBEAT_PAUSE_PATH, { method: 'POST', body: { until }, headers: { Authorization: `Bearer ${token}` } });
}

/** Sets the pause straight in D1, so it can lie in the past. */
export async function setPausedUntil(until: string | null): Promise<void> {
  await env.DB.prepare('UPDATE heartbeats SET paused_until = ? WHERE id = 1').bind(until).run();
}

/** An admin API write with ADMIN_API_TOKEN, as a script or agent sends it. */
export function asAdmin(path: string, body: unknown): Promise<Response> {
  return call(path, { method: 'POST', body, headers: { Authorization: `Bearer ${env.ADMIN_API_TOKEN}` } });
}

/** Runs the Worker's scheduled handler, by default as the outage-detection cron; `testEnv` swaps bindings, such as a stub queue. */
export async function runCron(cron = MINUTE_CRON, scheduledTime = Date.now(), testEnv: Env = env): Promise<void> {
  await worker.scheduled(createScheduledController({ scheduledTime, cron }), testEnv);
}

/** Outages that are open and not dismissed as false positives. */
export async function openOutageCount(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM outages WHERE end_time IS NULL AND is_false_positive = 0',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
