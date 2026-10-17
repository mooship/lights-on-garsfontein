import { z } from 'zod';
import type {
  ConfirmRequest,
  ConfirmResponse,
  StatusResponse,
  StillOffRequest,
  StillOffResponse,
} from '../../shared/api';
import { CSV_PATH, OUTAGE_VIEWS, STATUS_PATH } from '../../shared/paths';
import { outageConfirmations } from '../db/schema';
import { requireBearer } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';
import {
  countConfirmations,
  countStillOffReports,
  detectOutage,
  getGridState,
  recordHeartbeat,
  recordStillOff,
} from '../lib/grid';
import { errors, json, parseBody } from '../lib/http';
import { purgeEdgeCache, type RouteContext, type Routes } from '../lib/router';
import { checkTurnstile } from '../lib/turnstile';

const confirmSchema = z.object({
  token: z.string().min(1).max(2048),
  outageId: z.number().int().positive().optional(),
}) satisfies z.ZodType<ConfirmRequest>;

const stillOffSchema = z.object({ token: z.string().min(1).max(2048) }) satisfies z.ZodType<StillOffRequest>;

/**
 * Edge TTL for the status, which every open tab polls. Writes purge it (in the datacentre that
 * handled them), so mostly it only delays OFF after a heartbeat goes stale, by up to this much on
 * top of HEARTBEAT_THRESHOLD_MS. Browsers still get `no-store`.
 */
const STATUS_EDGE_TTL_SECONDS = 12;

/** The outage was deleted between reading it and inserting the confirmation. */
function isForeignKeyError(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e.message.includes('FOREIGN KEY constraint failed')) return true;
  }
  return false;
}

async function getStatus({ env, db }: RouteContext): Promise<Response> {
  const now = new Date();
  const body: StatusResponse = {
    ...(await getGridState(db, now)),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    generatedAt: now.toISOString(),
  };
  return json(body);
}

/** Salted hash of the rate-limit key (IPv6 grouped by /64), so rotating addresses within a /64 counts once. */
const clientFingerprint = (salt: string, limitKey: string) => sha256Hex(`${salt}:${limitKey}`);

async function postConfirm(ctx: RouteContext): Promise<Response> {
  const { request, env, db, limitKey } = ctx;
  const parsed = await parseBody(request, confirmSchema);
  if ('response' in parsed) return parsed.response;
  // Without the salt the stored fingerprints would be trivially reversible.
  if (!env.IP_SALT) return errors.internal();
  const refused = await checkTurnstile(ctx, parsed.data.token, 'confirm');
  if (refused) return refused;

  const { outage, opened } = await detectOutage(db, new Date());
  // The route purges what a confirmation changes; an outage opened here changes every view, refused or not.
  if (opened) await purgeEdgeCache(new URL(request.url).origin, OUTAGE_VIEWS);
  if (!outage) return errors.conflict('no_active_outage');
  // The visitor saw an outage that has since ended and another began: do not count them for it.
  if (parsed.data.outageId !== undefined && parsed.data.outageId !== outage.id) {
    return errors.conflict('outage_changed');
  }

  const clientHash = await clientFingerprint(env.IP_SALT, limitKey);
  let inserted: { id: number }[];
  try {
    inserted = await db
      .insert(outageConfirmations)
      .values({ outageId: outage.id, clientHash, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .returning({ id: outageConfirmations.id });
  } catch (error) {
    if (isForeignKeyError(error)) return errors.conflict('no_active_outage');
    throw error;
  }
  if (inserted.length === 0) return errors.conflict('already_confirmed');

  const body: ConfirmResponse = { confirmations: await countConfirmations(db, outage.id) };
  return json(body, 201);
}

/**
 * "Still off where you are?": only while the status is ON (while OFF the client offers confirm
 * instead). Reports are counted for the status and never change it.
 */
async function postStillOff(ctx: RouteContext): Promise<Response> {
  const { request, env, db, limitKey } = ctx;
  const parsed = await parseBody(request, stillOffSchema);
  if ('response' in parsed) return parsed.response;
  if (!env.IP_SALT) return errors.internal();
  const refused = await checkTurnstile(ctx, parsed.data.token, 'still_off');
  if (refused) return refused;

  // Same check as the status: an open outage, or a stale heartbeat (which this opens).
  const { outage, opened } = await detectOutage(db, new Date());
  if (opened) await purgeEdgeCache(new URL(request.url).origin, OUTAGE_VIEWS);
  if (outage) return errors.conflict('outage_in_progress');

  const now = new Date();
  if (!(await recordStillOff(db, await clientFingerprint(env.IP_SALT, limitKey), now))) {
    return errors.conflict('already_reported');
  }
  const body: StillOffResponse = { reports: await countStillOffReports(db, now) };
  return json(body, 201);
}

async function postHeartbeat({ db }: RouteContext): Promise<Response> {
  const closed = await recordHeartbeat(db, new Date());
  return json({ ok: true, closedOutages: closed });
}

export const statusRoutes: Routes = {
  [`GET ${STATUS_PATH}`]: {
    handler: getStatus,
    limiter: 'STATUS_LIMITER',
    cors: true,
    edgeCache: STATUS_EDGE_TTL_SECONDS,
  },
  'POST /api/confirm': {
    handler: postConfirm,
    sameOrigin: true,
    limiter: 'CONFIRM_LIMITER',
    // The confirmation counts are in the status and the CSV.
    purges: [STATUS_PATH, CSV_PATH],
  },
  'POST /api/still-off': {
    handler: postStillOff,
    sameOrigin: true,
    limiter: 'CONFIRM_LIMITER',
    purges: [STATUS_PATH],
  },
  // Until HEARTBEAT_TOKEN is set (no sensor yet), every heartbeat is refused.
  'POST /api/heartbeat': {
    handler: postHeartbeat,
    authorize: requireBearer((env) => env.HEARTBEAT_TOKEN),
    // Any heartbeat may close an outage or record one it missed.
    purges: OUTAGE_VIEWS,
  },
};
