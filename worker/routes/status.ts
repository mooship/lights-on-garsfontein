import { z } from 'zod';
import { DAY_MS, type StatusResponse } from '../../shared/api';
import { HEARTBEAT_PATH, HEARTBEAT_PAUSE_PATH, OUTAGE_VIEWS, STATUS_PATH } from '../../shared/paths';
import { requireBearer } from '../lib/auth';
import { getGridState, pauseSensor, recordHeartbeat } from '../lib/grid';
import { json, parseBody } from '../lib/http';
import { purgeEdgeCache, type RouteContext, type Routes } from '../lib/router';

/**
 * Edge TTL for the status, which every open tab polls. Writes purge it (in the datacentre that
 * handled them), so mostly it only delays OFF after a heartbeat goes stale, by up to this much on
 * top of HEARTBEAT_THRESHOLD_MS. Browsers still get `no-store`.
 */
const STATUS_EDGE_TTL_SECONDS = 12;

/** The longest pause, so a forgotten one cannot leave the sensor ignored for good. */
export const MAX_PAUSE_MS = 30 * DAY_MS;

const pauseSchema = z.object({
  until: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v).toISOString())
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
  if (request.headers.get('Content-Type')?.startsWith('application/json')) {
    const parsed = await parseBody(request, heartbeatSchema);
    if ('response' in parsed) return parsed.response;
    poweredFor = parsed.data.poweredFor;
  }
  const { closed, changed } = await recordHeartbeat(db, new Date(), poweredFor);
  // The status always, as its live reading changed; the other views only when an outage did, so a
  // sensor posting every minute does not keep emptying them.
  await purgeEdgeCache(new URL(request.url).origin, changed ? OUTAGE_VIEWS : [STATUS_PATH]);
  return json({ ok: true, closedOutages: closed });
}

/** For a sensor that will be away from its usual supply, such as a laptop leaving home. */
async function postPause({ db, request }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, pauseSchema);
  if ('response' in parsed) return parsed.response;
  const pausedUntil = await pauseSensor(db, parsed.data.until, new Date());
  await purgeEdgeCache(new URL(request.url).origin, [STATUS_PATH]);
  return json({ ok: true, pausedUntil });
}

export const statusRoutes: Routes = {
  [`GET ${STATUS_PATH}`]: {
    handler: getStatus,
    limiter: 'STATUS_LIMITER',
    cors: true,
    edgeCache: STATUS_EDGE_TTL_SECONDS,
  },
  // Until HEARTBEAT_TOKEN is set (no sensor yet), every heartbeat is refused.
  [`POST ${HEARTBEAT_PATH}`]: {
    handler: postHeartbeat,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
  },
  [`POST ${HEARTBEAT_PAUSE_PATH}`]: {
    handler: postPause,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
  },
};
