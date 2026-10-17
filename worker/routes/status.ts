import { z } from 'zod';
import type { ConfirmResponse, StatusResponse } from '../../shared/api';
import { createDb } from '../db/client';
import { outageConfirmations } from '../db/schema';
import { safeEqual, sha256Hex } from '../lib/crypto';
import { confirmationCounts, detectOutage, getGridState, recordHeartbeat } from '../lib/grid';
import { clientIp, errors, isCrossOrigin, isRateLimited, json, PUBLIC_CORS, parseBody } from '../lib/http';
import { verifyTurnstile } from '../lib/turnstile';

const confirmSchema = z.object({ token: z.string().min(1).max(2048) });

async function getStatus(request: Request, env: Env): Promise<Response> {
  if (await isRateLimited(env.STATUS_LIMITER, clientIp(request))) return errors.rateLimited();
  const now = new Date();
  const state = await getGridState(createDb(env.DB), now);
  const body: StatusResponse = {
    ...state,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    generatedAt: now.toISOString(),
  };
  return json(body, 200, PUBLIC_CORS);
}

async function postConfirm(request: Request, env: Env): Promise<Response> {
  if (isCrossOrigin(request)) return errors.forbidden();
  const ip = clientIp(request);
  if (await isRateLimited(env.CONFIRM_LIMITER, ip)) return errors.rateLimited();

  const parsed = await parseBody(request, confirmSchema);
  if ('response' in parsed) return parsed.response;
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, parsed.data.token, ip))) {
    return json({ error: 'turnstile_failed' }, 403);
  }

  const db = createDb(env.DB);
  const outage = await detectOutage(db, new Date());
  if (!outage) return errors.conflict('no_active_outage');

  const clientHash = await sha256Hex(`${env.IP_SALT}:${ip}`);
  const inserted = await db
    .insert(outageConfirmations)
    .values({ outageId: outage.id, clientHash, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning({ id: outageConfirmations.id });
  if (inserted.length === 0) return errors.conflict('already_confirmed');

  const counts = await confirmationCounts(db, [outage.id]);
  const body: ConfirmResponse = { confirmations: counts.get(outage.id) ?? 0 };
  return json(body, 201);
}

async function postHeartbeat(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await safeEqual(token, env.HEARTBEAT_TOKEN))) return errors.unauthorized();
  const closed = await recordHeartbeat(createDb(env.DB), new Date());
  return json({ ok: true, closedOutages: closed });
}

export async function handleStatusRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/status':
      return getStatus(request, env);
    case 'POST /api/confirm':
      return postConfirm(request, env);
    case 'POST /api/heartbeat':
      return postHeartbeat(request, env);
    default:
      return null;
  }
}
