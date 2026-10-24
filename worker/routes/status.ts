import { z } from 'zod';
import type { StatusResponse } from '../../shared/api';
import { HEARTBEAT_PATH, HEARTBEAT_PAUSE_PATH, LIVE_VIEWS, OUTAGE_VIEWS, STATUS_PATH } from '../../shared/paths';
import { requireBearer } from '../lib/auth';
import { getGridState, MAX_PAUSE_MS, pauseSensor, recordHeartbeat } from '../lib/grid';
import { isJson, isoTime, json, parseBody } from '../lib/http';
import { purgeEdgeCache, type RouteContext, type Routes } from '../lib/router';

/**
 * Edge TTL for the status, which every open tab polls. Writes purge it (in the datacentre that
 * handled them), so mostly it only delays OFF after a heartbeat goes stale, by up to this much on
 * top of HEARTBEAT_THRESHOLD_MS. Browsers still get `no-store`. The full outage list (OUTAGES_PATH)
 * uses it too, as the page reloads that list when the status changes.
 */
export const STATUS_EDGE_TTL_SECONDS = 12;

const pauseSchema = z.object({
  until: isoTime()
    .refine((v) => Date.parse(v) > Date.now(), 'time_in_past')
    .refine((v) => Date.parse(v) <= Date.now() + MAX_PAUSE_MS, 'pause_too_long')
    .nullable(),
});

async function getStatus({ env, db }: RouteContext): Promise<Response> {
  const now = new Date();
  const body: StatusResponse = {
    ...(await getGridState(db, now)),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    generatedAt: now.toISOString(),
  };
  return json(body);
}

const heartbeatSchema = z.object({ poweredFor: z.int().nonnegative().default(0) });

async function postHeartbeat({ db, request }: RouteContext): Promise<Response> {
  // The body is optional: a sensor that cannot tell how long it has had power posts none.
  let poweredFor = 0;
  if (isJson(request.headers.get('Content-Type') ?? '')) {
    const parsed = await parseBody(request, heartbeatSchema);
    if ('response' in parsed) return parsed.response;
    poweredFor = parsed.data.poweredFor;
  }
  const { closed, changed } = await recordHeartbeat(db, new Date(), poweredFor);
  // The live views always, as the reading changed; the other views only when an outage did, so a
  // sensor posting every minute does not keep emptying them.
  await purgeEdgeCache(new URL(request.url).origin, changed ? OUTAGE_VIEWS : LIVE_VIEWS);
  return json({ ok: true, closedOutages: closed });
}

/** For a sensor that will be away from its usual supply, such as a laptop leaving home. */
async function postPause({ db, request }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, pauseSchema);
  if ('response' in parsed) return parsed.response;
  const pausedUntil = await pauseSensor(db, parsed.data.until, new Date());
  await purgeEdgeCache(new URL(request.url).origin, LIVE_VIEWS);
  return json({ ok: true, pausedUntil });
}

export const statusRoutes: Routes = {
  [`GET ${STATUS_PATH}`]: {
    handler: getStatus,
    limiter: 'STATUS_LIMITER',
    cors: true,
    edgeCache: STATUS_EDGE_TTL_SECONDS,
  },
  [`POST ${HEARTBEAT_PATH}`]: {
    handler: postHeartbeat,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
  },
  [`POST ${HEARTBEAT_PAUSE_PATH}`]: {
    handler: postPause,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
  },
};
