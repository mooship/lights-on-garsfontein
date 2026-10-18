import { createScheduledController, env } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import { MINUTE_MS, type StatusResponse, TURNSTILE_ACTION, type TurnstileAction } from '../shared/api';
import { CSV_PATH, FEED_PATH, LOGIN_PATH, STATS_PATH, STATUS_PATH } from '../shared/paths';
import { MINUTE_CRON } from '../worker/crons';
import worker from '../worker/index';
import { SESSION_COOKIE } from '../worker/lib/cookies';
import { randomToken, sha256Hex } from '../worker/lib/crypto';
import { CLIENT_IP_HEADER } from '../worker/lib/http';
import { ADMIN_USER_ID, passwordFingerprint, SESSION_TTL_MS } from '../worker/routes/auth';

/** The test SITE_URL (set once in vitest.config.ts). */
export const ORIGIN = env.SITE_URL;

/** Every route with `edgeCache`; test/setup.ts empties their cached copies before each test. */
export const EDGE_CACHED = [STATUS_PATH, STATS_PATH, CSV_PATH, FEED_PATH];

/**
 * Waits for a new rate-limit window when this one has under 10 s left. Miniflare counts in
 * one-minute windows on the wall clock, so a loop that crosses a boundary starts counting again.
 * Call it right before a loop that expects to reach a limit.
 */
export async function sameWindow(): Promise<void> {
  const elapsed = Date.now() % MINUTE_MS;
  if (elapsed > 50_000) await new Promise((resolve) => setTimeout(resolve, MINUTE_MS - elapsed));
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

/** Stubs the Turnstile siteverify call with `answer`; other fetches go through. */
export function mockSiteverify(answer: () => Response | Promise<Response>) {
  const realFetch = globalThis.fetch;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === 'challenges.cloudflare.com') return answer();
    return realFetch(input, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

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
  await env.DB.prepare('INSERT OR REPLACE INTO heartbeats (id, last_seen) VALUES (1, ?)').bind(lastSeen).run();
  return lastSeen;
}

/** Writes an outage straight to D1, so nothing purges the edge cache; by default an open sensor outage. */
export async function insertOutage(values: {
  startTime?: string;
  endTime?: string | null;
  source?: 'sensor' | 'manual';
  isFalsePositive?: 0 | 1;
  isPlanned?: 0 | 1;
}): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO outages (start_time, end_time, source, is_false_positive, is_planned) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(
      values.startTime ?? new Date(Date.now() - 10 * MINUTE_MS).toISOString(),
      values.endTime ?? null,
      values.source ?? 'sensor',
      values.isFalsePositive ?? 0,
      values.isPlanned ?? 0,
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

/** Signs in through the login route; prefer createSession unless the test is about signing in. */
export async function login(password = 'test-password'): Promise<string> {
  mockTurnstile(true, TURNSTILE_ACTION.login);
  const res = await call(LOGIN_PATH, {
    method: 'POST',
    body: { username: 'admin', password, token: 'turnstile-token' },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

/** Runs the Worker's scheduled handler, by default as the outage-detection cron. */
export async function runCron(cron = MINUTE_CRON, scheduledTime = Date.now()): Promise<void> {
  await worker.scheduled(createScheduledController({ scheduledTime, cron }), env);
}

/** Outages that are open and not dismissed as false positives. */
export async function openOutageCount(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM outages WHERE end_time IS NULL AND is_false_positive = 0',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
