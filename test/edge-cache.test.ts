import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_THRESHOLD_MS, HOUR_MS, OUTAGE_ACTION, TIMER_ACTION } from '../shared/api';
import { ADMIN_OUTAGES_PATH, LIVE_VIEWS, OUTAGE_VIEWS, STATUS_PATH, TIMER_PATH } from '../shared/paths';
import {
  asAdmin,
  call,
  EDGE_CACHED,
  heartbeat,
  insertOutage,
  ORIGIN,
  requestPause,
  runCron,
  setHeartbeat,
  stubLimiter,
} from './helpers';

// Every edge-cached route is a view of the outages, so a write that opens, closes or changes one
// must purge them all; otherwise readers get the old outages until the cached copy expires.

const isCached = async (path: string) => (await caches.default.match(`${ORIGIN}${path}`)) !== undefined;

const openOutage = () => insertOutage({});

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
  { name: 'punching out', act: () => asAdmin(TIMER_PATH, { action: TIMER_ACTION.punchOut }), status: 201 },
  {
    name: 'punching in',
    arrange: openOutage,
    act: () => asAdmin(TIMER_PATH, { action: TIMER_ACTION.punchIn }),
    status: 200,
  },
  {
    name: 'logging an outage',
    act: () => asAdmin(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.create, startTime: '2026-10-17T08:00:00Z' }),
    status: 201,
  },
  {
    name: 'flagging a false positive',
    arrange: openOutage,
    act: (id) => asAdmin(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, isFalsePositive: true }),
    status: 200,
  },
  {
    name: 'deleting an outage',
    arrange: openOutage,
    act: (id) => asAdmin(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.delete, id }),
    status: 200,
  },
  {
    name: 'a heartbeat that closes an outage',
    arrange: openOutage,
    act: () => heartbeat(),
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
  it('every edge-cached route is an outage view, so outage writes purge it', () => {
    expect(EDGE_CACHED.length).toBeGreaterThan(0);
    for (const path of EDGE_CACHED) expect(OUTAGE_VIEWS, path).toContain(path);
  });

  it.each(WRITES)('$name purges every cached view', async ({ arrange, act, status }) => {
    const id = (await arrange?.()) ?? 0;
    for (const path of EDGE_CACHED) {
      expect((await call(path)).status, path).toBe(200);
      expect(await isCached(path), path).toBe(true);
    }
    expect((await act(id))?.status).toBe(status);
    for (const path of EDGE_CACHED) expect(await isCached(path), path).toBe(false);
  });

  it('a routine heartbeat purges only the live views (status and badges), whose reading it changes', async () => {
    await setHeartbeat(30);
    for (const path of EDGE_CACHED) await call(path);
    expect((await heartbeat()).status).toBe(200);
    for (const path of LIVE_VIEWS) expect(await isCached(path), path).toBe(false);
    for (const path of EDGE_CACHED.filter((p) => !LIVE_VIEWS.includes(p)))
      expect(await isCached(path), path).toBe(true);
  });
});

describe('pausing outage detection', () => {
  // A pause changes whether the status and badges are backed by a live reading, and nothing else.
  it.each([
    ['starting a pause', () => new Date(Date.now() + HOUR_MS).toISOString()],
    ['ending a pause', () => null],
  ])('%s purges only the live views', async (_name, until) => {
    await setHeartbeat(30);
    for (const path of EDGE_CACHED) await call(path);
    expect((await requestPause(until())).status).toBe(200);
    for (const path of LIVE_VIEWS) expect(await isCached(path), path).toBe(false);
    for (const path of EDGE_CACHED.filter((p) => !LIVE_VIEWS.includes(p)))
      expect(await isCached(path), path).toBe(true);
  });
});

describe('edge cache and rate limits', () => {
  // A refused request has already reached the Worker, so the limit saves only the D1 work behind a
  // cache miss. Many readers can share one address on a mobile network, and an outage is when they
  // all check, so a cached copy never counts against it.
  it('serves a cached view without counting it against the limit', async () => {
    const limiter = stubLimiter(false);
    for (const path of EDGE_CACHED) {
      expect((await call(path)).status, path).toBe(200);
      const response = await call(path, { env: { ...env, STATUS_LIMITER: limiter } });
      expect(response.status, path).toBe(200);
    }
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it('still limits a read the cache cannot answer', async () => {
    const response = await call(STATUS_PATH, { env: { ...env, STATUS_LIMITER: stubLimiter(false) } });
    expect(response.status).toBe(429);
  });
});
