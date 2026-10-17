import { z } from 'zod';
import type { ConfirmResponse, StatusResponse } from '../../shared/api';
import { outageConfirmations } from '../db/schema';
import { requireBearer } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';
import { countConfirmations, detectOutage, getGridState, recordHeartbeat } from '../lib/grid';
import { errors, json, parseBody } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { checkTurnstile } from '../lib/turnstile';

const confirmSchema = z.object({ token: z.string().min(1).max(2048) });

async function getStatus({ env, db }: RouteContext): Promise<Response> {
  const now = new Date();
  const body: StatusResponse = {
    ...(await getGridState(db, now)),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    generatedAt: now.toISOString(),
  };
  return json(body);
}

async function postConfirm(ctx: RouteContext): Promise<Response> {
  const { request, env, db, ip } = ctx;
  const parsed = await parseBody(request, confirmSchema);
  if ('response' in parsed) return parsed.response;
  // Without the salt the stored fingerprints would be trivially reversible.
  if (!env.IP_SALT) return errors.internal();
  const refused = await checkTurnstile(ctx, parsed.data.token, 'confirm');
  if (refused) return refused;

  const outage = await detectOutage(db, new Date());
  if (!outage) return errors.conflict('no_active_outage');

  const clientHash = await sha256Hex(`${env.IP_SALT}:${ip}`);
  const inserted = await db
    .insert(outageConfirmations)
    .values({ outageId: outage.id, clientHash, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning({ id: outageConfirmations.id });
  if (inserted.length === 0) return errors.conflict('already_confirmed');

  const body: ConfirmResponse = { confirmations: await countConfirmations(db, outage.id) };
  return json(body, 201);
}

async function postHeartbeat({ db }: RouteContext): Promise<Response> {
  const closed = await recordHeartbeat(db, new Date());
  return json({ ok: true, closedOutages: closed });
}

export const statusRoutes: Routes = {
  'GET /api/status': { handler: getStatus, limiter: 'STATUS_LIMITER', cors: true },
  'POST /api/confirm': { handler: postConfirm, sameOrigin: true, limiter: 'CONFIRM_LIMITER' },
  // Until HEARTBEAT_TOKEN is set (no sensor yet), every heartbeat is refused.
  'POST /api/heartbeat': { handler: postHeartbeat, authorize: requireBearer((env) => env.HEARTBEAT_TOKEN) },
};
