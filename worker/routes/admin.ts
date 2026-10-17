import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminOutagesResponse } from '../../shared/api';
import { createDb } from '../db/client';
import { outages } from '../db/schema';
import { safeEqual } from '../lib/crypto';
import { getOpenOutage, outagesWithCounts } from '../lib/grid';
import { clientIp, errors, isCrossOrigin, isRateLimited, json, parseBody } from '../lib/http';
import { getSessionUser } from './auth';

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());

const timerSchema = z.object({ action: z.enum(['punch_out', 'punch_in']) });

const outageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    startTime: isoDate,
    endTime: isoDate.nullable().optional(),
    isPlanned: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    endTime: isoDate.nullable().optional(),
    isFalsePositive: z.boolean().optional(),
    isPlanned: z.boolean().optional(),
  }),
  z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
]);

async function listOutages(env: Env): Promise<Response> {
  const rows = await outagesWithCounts(createDb(env.DB)).orderBy(desc(outages.startTime)).limit(50);
  const body: AdminOutagesResponse = {
    outages: rows.map(({ isPlanned, ...r }) => ({
      ...r,
      planned: isPlanned === 1,
      isFalsePositive: r.isFalsePositive === 1,
    })),
  };
  return json(body);
}

/** Punch clock: punch out when the power goes off, punch in when it comes back. */
async function timer(request: Request, env: Env): Promise<Response> {
  const parsed = await parseBody(request, timerSchema);
  if ('response' in parsed) return parsed.response;
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const open = await getOpenOutage(db);

  if (parsed.data.action === 'punch_out') {
    if (open) return errors.conflict('outage_already_open');
    const [outage] = await db.insert(outages).values({ startTime: now, source: 'manual' }).returning();
    return json({ outage }, 201);
  }

  if (!open) return errors.conflict('no_open_outage');
  const [outage] = await db
    .update(outages)
    .set({ endTime: now })
    .where(and(eq(outages.id, open.id), isNull(outages.endTime)))
    .returning();
  return json({ outage });
}

async function mutateOutage(request: Request, env: Env): Promise<Response> {
  const parsed = await parseBody(request, outageSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const db = createDb(env.DB);

  if (input.action === 'create') {
    if (input.endTime && input.endTime < input.startTime) return errors.badRequest('end_before_start');
    const [outage] = await db
      .insert(outages)
      .values({
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        source: 'manual',
        isPlanned: input.isPlanned ? 1 : 0,
      })
      .returning();
    return json({ outage }, 201);
  }

  const existing = await db.query.outages.findFirst({ where: eq(outages.id, input.id) });
  if (!existing) return errors.notFound();

  if (input.action === 'delete') {
    await db.delete(outages).where(eq(outages.id, input.id));
    return json({ ok: true });
  }

  const changes: Partial<typeof outages.$inferInsert> = {};
  if (input.endTime !== undefined) changes.endTime = input.endTime;
  if (input.isPlanned !== undefined) changes.isPlanned = input.isPlanned ? 1 : 0;
  if (input.isFalsePositive !== undefined) {
    changes.isFalsePositive = input.isFalsePositive ? 1 : 0;
    // A false positive should not stay open and keep the grid "OFF".
    if (input.isFalsePositive && !existing.endTime && changes.endTime === undefined) {
      changes.endTime = new Date().toISOString();
    }
  }
  const endTime = changes.endTime === undefined ? existing.endTime : changes.endTime;
  if (endTime && endTime < existing.startTime) return errors.badRequest('end_before_start');
  if (Object.keys(changes).length === 0) return json({ outage: existing });

  const [outage] = await db.update(outages).set(changes).where(eq(outages.id, input.id)).returning();
  return json({ outage });
}

/**
 * Admin access for scripts and AI agents: `Authorization: Bearer <ADMIN_API_TOKEN>`.
 * Returns null when no bearer token was sent, so the session cookie is checked instead.
 */
async function checkApiToken(request: Request, env: Env): Promise<boolean | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  if (!env.ADMIN_API_TOKEN) return false;
  return safeEqual(auth.slice(7), env.ADMIN_API_TOKEN);
}

export async function handleAdminRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const route = `${request.method} ${url.pathname}`;
  const handlers: Record<string, () => Promise<Response>> = {
    'GET /api/admin/outages': () => listOutages(env),
    'POST /api/admin/outages': () => mutateOutage(request, env),
    'POST /api/admin/timer': () => timer(request, env),
  };
  const handler = handlers[route];
  if (!handler) return null;
  const token = await checkApiToken(request, env);
  if (token === false) {
    // Wrong tokens share the login rate limit, so they cannot be brute-forced.
    if (await isRateLimited(env.LOGIN_LIMITER, clientIp(request))) return errors.rateLimited();
    return errors.unauthorized();
  }
  if (token === null) {
    if (request.method !== 'GET' && isCrossOrigin(request)) return errors.forbidden();
    if (!(await getSessionUser(request, env))) return errors.unauthorized();
  }
  return handler();
}
