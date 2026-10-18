import type { StatusResponse } from '../../shared/api';
import { OUTAGE_VIEWS, STATUS_PATH } from '../../shared/paths';
import { requireBearer } from '../lib/auth';
import { getGridState, recordHeartbeat } from '../lib/grid';
import { json } from '../lib/http';
import { purgeEdgeCache, type RouteContext, type Routes } from '../lib/router';

/**
 * Edge TTL for the status, which every open tab polls. Writes purge it (in the datacentre that
 * handled them), so mostly it only delays OFF after a heartbeat goes stale, by up to this much on
 * top of HEARTBEAT_THRESHOLD_MS. Browsers still get `no-store`.
 */
const STATUS_EDGE_TTL_SECONDS = 12;

async function getStatus({ env, db }: RouteContext): Promise<Response> {
  const now = new Date();
  const body: StatusResponse = {
    ...(await getGridState(db, now)),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    generatedAt: now.toISOString(),
  };
  return json(body);
}

async function postHeartbeat({ db, request }: RouteContext): Promise<Response> {
  const { closed, changed } = await recordHeartbeat(db, new Date());
  // The route purges the status (its live reading); the other views only when an outage changed,
  // so a sensor posting every minute does not keep emptying them.
  if (changed) await purgeEdgeCache(new URL(request.url).origin, OUTAGE_VIEWS);
  return json({ ok: true, closedOutages: closed });
}

export const statusRoutes: Routes = {
  [`GET ${STATUS_PATH}`]: {
    handler: getStatus,
    limiter: 'STATUS_LIMITER',
    cors: true,
    edgeCache: STATUS_EDGE_TTL_SECONDS,
  },
  // Until HEARTBEAT_TOKEN is set (no sensor yet), every heartbeat is refused.
  'POST /api/heartbeat': {
    handler: postHeartbeat,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
    purges: [STATUS_PATH],
  },
};
