import { env } from 'cloudflare:test';
import { vi } from 'vitest';
import worker from '../worker/index';

export const ORIGIN = 'https://garsfontein.example';

let ipCounter = 0;
/** A fresh client IP so rate-limit buckets never leak between tests. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  ip?: string;
  cookie?: string;
  headers?: Record<string, string>;
  env?: Env;
}

export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('CF-Connecting-IP', options.ip ?? uniqueIp());
  if (options.cookie) headers.set('Cookie', options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  const request = new Request(`${ORIGIN}${path}`, { method: options.method ?? 'GET', headers, body });
  return worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, options.env ?? env);
}

/** Stubs the Turnstile siteverify call with the given outcome. */
export function mockTurnstile(success: boolean) {
  const realFetch = globalThis.fetch;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('challenges.cloudflare.com')) return Response.json({ success });
    return realFetch(input, init);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export async function setHeartbeat(secondsAgo: number): Promise<string> {
  const lastSeen = new Date(Date.now() - secondsAgo * 1000).toISOString();
  await env.DB.prepare('INSERT OR REPLACE INTO heartbeats (id, last_seen) VALUES (1, ?)').bind(lastSeen).run();
  return lastSeen;
}

export async function insertOutage(values: {
  startTime?: string;
  endTime?: string | null;
  source?: 'sensor' | 'manual';
  isFalsePositive?: 0 | 1;
}): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO outages (start_time, end_time, source, is_false_positive) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(
      values.startTime ?? new Date(Date.now() - 600_000).toISOString(),
      values.endTime ?? null,
      values.source ?? 'sensor',
      values.isFalsePositive ?? 0,
    )
    .first<{ id: number }>();
  if (!row) throw new Error('insert failed');
  return row.id;
}

export async function login(password = 'test-password'): Promise<string> {
  const res = await call('/api/admin/login', { method: 'POST', body: { password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}
