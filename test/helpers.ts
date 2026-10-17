import { createScheduledController, env } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import type { StatusResponse, TurnstileAction } from '../shared/api';
import worker from '../worker/index';

/** The test SITE_URL (set once in vitest.config.ts). */
export const ORIGIN = env.SITE_URL;

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

export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('CF-Connecting-IP', options.ip ?? uniqueIp());
  if (options.cookie) headers.set('Cookie', options.cookie);
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const request = new Request(`${ORIGIN}${path}`, { method: options.method ?? 'GET', headers, body });
  return worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, options.env ?? env);
}

/** Stubs the Turnstile siteverify call: a token solved on our host for `action`. */
export function mockTurnstile(
  success: boolean,
  action: TurnstileAction = 'confirm',
  hostname = new URL(ORIGIN).hostname,
) {
  const realFetch = globalThis.fetch;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === 'challenges.cloudflare.com') return Response.json({ success, action, hostname });
    return realFetch(input, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await call('/api/status');
  expect(res.status).toBe(200);
  return res.json();
}

export async function insertConfirmation(
  outageId: number,
  { createdAt = new Date().toISOString(), clientHash = 'fingerprint' } = {},
): Promise<void> {
  await env.DB.prepare('INSERT INTO outage_confirmations (outage_id, created_at, client_hash) VALUES (?, ?, ?)')
    .bind(outageId, createdAt, clientHash)
    .run();
}

export async function setHeartbeat(secondsAgo: number): Promise<string> {
  const lastSeen = new Date(Date.now() - secondsAgo * 1000).toISOString();
  await env.DB.prepare('INSERT OR REPLACE INTO heartbeats (id, last_seen) VALUES (1, ?)').bind(lastSeen).run();
  return lastSeen;
}

export async function insertStillOff({ createdAt = new Date().toISOString(), clientHash = 'fingerprint' } = {}) {
  await env.DB.prepare('INSERT INTO still_off_reports (created_at, client_hash) VALUES (?, ?)')
    .bind(createdAt, clientHash)
    .run();
}

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
      values.startTime ?? new Date(Date.now() - 600_000).toISOString(),
      values.endTime ?? null,
      values.source ?? 'sensor',
      values.isFalsePositive ?? 0,
      values.isPlanned ?? 0,
    )
    .first<{ id: number }>();
  if (!row) throw new Error('insert failed');
  return row.id;
}

export async function login(password = 'test-password'): Promise<string> {
  mockTurnstile(true, 'login');
  const res = await call('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password, token: 'turnstile-token' },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

/** The per-minute (outage detection) and hourly (housekeeping) crons in wrangler.toml. */
export const MINUTE_CRON = '* * * * *';
export const HOURLY_CRON = '0 * * * *';

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
