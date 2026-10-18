import { describe, expect, it } from 'vitest';
import { HEARTBEAT_THRESHOLD_MS } from '../shared/api';
import { call, EDGE_CACHED, insertOutage, ORIGIN, runCron, setHeartbeat } from './helpers';

// Every edge-cached route is a view of the outages, so a write that opens, closes or changes one
// must purge them all; otherwise readers get the old outages until the cached copy expires.

const isCached = async (path: string) => (await caches.default.match(`${ORIGIN}${path}`)) !== undefined;

const admin = (path: string, body: unknown) =>
  call(path, { method: 'POST', body, headers: { Authorization: 'Bearer test-admin-api-token' } });

const openOutage = () => insertOutage({});

const heartbeat = () =>
  call('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer test-heartbeat-token' } });

/** A silent sensor with nothing on record yet: the next check opens an outage. */
async function staleHeartbeat(): Promise<undefined> {
  await setHeartbeat(HEARTBEAT_THRESHOLD_MS / 1000 + 60);
  return undefined;
}

interface Write {
  name: string;
  /** Returns the id of an outage it created, for `act`. */
  arrange?: () => Promise<number | undefined>;
  act: (id: number) => Promise<Response | undefined>;
  /** The write's status; none for the cron. */
  status?: number;
}

const WRITES: Write[] = [
  { name: 'punching out', act: () => admin('/api/admin/timer', { action: 'punch_out' }), status: 201 },
  {
    name: 'punching in',
    arrange: openOutage,
    act: () => admin('/api/admin/timer', { action: 'punch_in' }),
    status: 200,
  },
  {
    name: 'logging an outage',
    act: () => admin('/api/admin/outages', { action: 'create', startTime: '2026-10-17T08:00:00Z' }),
    status: 201,
  },
  {
    name: 'flagging a false positive',
    arrange: openOutage,
    act: (id) => admin('/api/admin/outages', { action: 'update', id, isFalsePositive: true }),
    status: 200,
  },
  {
    name: 'deleting an outage',
    arrange: openOutage,
    act: (id) => admin('/api/admin/outages', { action: 'delete', id }),
    status: 200,
  },
  {
    name: 'a heartbeat that closes an outage',
    arrange: openOutage,
    act: () => call('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer test-heartbeat-token' } }),
    status: 200,
  },
  {
    name: 'a heartbeat that records a missed outage',
    arrange: staleHeartbeat,
    act: () => heartbeat(),
    status: 200,
  },
  { name: 'outage detection opening an outage', arrange: staleHeartbeat, act: async () => void (await runCron()) },
];

describe('edge cache purges', () => {
  it.each(WRITES)('$name purges every cached view', async ({ arrange, act, status }) => {
    const id = (await arrange?.()) ?? 0;
    for (const path of EDGE_CACHED) {
      expect((await call(path)).status, path).toBe(200);
      expect(await isCached(path), path).toBe(true);
    }
    expect((await act(id))?.status).toBe(status);
    for (const path of EDGE_CACHED) expect(await isCached(path), path).toBe(false);
  });

  it('a routine heartbeat purges only the status, whose live reading it changes', async () => {
    await setHeartbeat(30);
    for (const path of EDGE_CACHED) await call(path);
    expect((await heartbeat()).status).toBe(200);
    expect(await isCached('/api/status')).toBe(false);
    for (const path of EDGE_CACHED.filter((p) => p !== '/api/status')) expect(await isCached(path), path).toBe(true);
  });
});
