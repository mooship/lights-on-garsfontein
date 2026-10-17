import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { StatusResponse } from '../shared/api';
import { call, insertOutage, setHeartbeat, uniqueIp } from './helpers';

async function status(): Promise<StatusResponse> {
  const res = await call('/api/status');
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/status', () => {
  it('is ON in manual mode before any sensor heartbeat arrives', async () => {
    const body = await status();
    expect(body).toMatchObject({ status: 'ON', mode: 'manual', lastSeen: null, turnstileSiteKey: 'test-site-key' });
  });

  it('is OFF in manual mode while the admin has an outage open', async () => {
    await insertOutage({ source: 'manual' });
    expect(await status()).toMatchObject({ status: 'OFF', mode: 'manual' });
  });

  it('switches to sensor mode on the first heartbeat', async () => {
    await call('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer test-heartbeat-token' } });
    expect(await status()).toMatchObject({ status: 'ON', mode: 'sensor' });
  });

  it('is ON while heartbeats are fresh', async () => {
    const lastSeen = await setHeartbeat(30);
    const body = await status();
    expect(body.status).toBe('ON');
    expect(body.lastSeen).toBe(lastSeen);
  });

  it('is OFF once the heartbeat is older than 180 seconds', async () => {
    const lastSeen = await setHeartbeat(181);
    const body = await status();
    expect(body.status).toBe('OFF');
    expect(body.since).toBe(lastSeen);
  });

  it('is OFF while an outage is open, even with a fresh heartbeat', async () => {
    await setHeartbeat(10);
    const startTime = new Date(Date.now() - 60_000).toISOString();
    const id = await insertOutage({ startTime, source: 'manual' });
    const body = await status();
    expect(body.status).toBe('OFF');
    expect(body.since).toBe(startTime);
    expect(body.outage?.id).toBe(id);
  });

  it('ignores false-positive outages', async () => {
    await setHeartbeat(10);
    await insertOutage({ isFalsePositive: 1 });
    const body = await status();
    expect(body.status).toBe('ON');
    expect(body.recent).toHaveLength(0);
  });

  it('reports ON since the end of the last outage', async () => {
    await setHeartbeat(10);
    const endTime = new Date(Date.now() - 120_000).toISOString();
    await insertOutage({ startTime: new Date(Date.now() - 900_000).toISOString(), endTime });
    const body = await status();
    expect(body.since).toBe(endTime);
    expect(body.recent[0]?.endTime).toBe(endTime);
  });

  it('is never cached', async () => {
    const res = await call('/api/status');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rate limits at 60 requests per minute per IP', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 60; i++) {
      expect((await call('/api/status', { ip })).status).toBe(200);
    }
    expect((await call('/api/status', { ip })).status).toBe(429);
    expect((await call('/api/status')).status).toBe(200);
  });
});

describe('POST /api/heartbeat', () => {
  const auth = { Authorization: 'Bearer test-heartbeat-token' };

  it('rejects requests without the sensor token', async () => {
    expect((await call('/api/heartbeat', { method: 'POST' })).status).toBe(401);
    const wrong = await call('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('rejects every heartbeat while no sensor token is configured', async () => {
    const noToken = { ...env, HEARTBEAT_TOKEN: '' } as Env;
    const res = await call('/api/heartbeat', {
      method: 'POST',
      headers: { Authorization: 'Bearer undefined' },
      env: noToken,
    });
    expect(res.status).toBe(401);
    const forged = await call('/api/heartbeat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
      env: noToken,
    });
    expect(forged.status).toBe(401);
  });

  it('records the heartbeat', async () => {
    const res = await call('/api/heartbeat', { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT last_seen FROM heartbeats WHERE id = 1').first<{ last_seen: string }>();
    expect(Date.now() - Date.parse(row?.last_seen ?? '')).toBeLessThan(5_000);
  });

  it('closes open sensor outages but leaves manual ones to the admin', async () => {
    const sensor = await insertOutage({ source: 'sensor' });
    const manual = await insertOutage({ source: 'manual' });
    const res = await call('/api/heartbeat', { method: 'POST', headers: auth });
    expect(await res.json()).toEqual({ ok: true, closedOutages: 1 });
    const rows = await env.DB.prepare('SELECT id, end_time FROM outages ORDER BY id').all<{
      id: number;
      end_time: string | null;
    }>();
    expect(rows.results.find((r) => r.id === sensor)?.end_time).not.toBeNull();
    expect(rows.results.find((r) => r.id === manual)?.end_time).toBeNull();
  });
});
