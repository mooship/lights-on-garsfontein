import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type AdminOutagesResponse, MINUTE_MS, type TimerAction } from '../../shared/api';
import { OUTAGE_VIEWS } from '../../shared/paths';
import { outages } from '../db/schema';
import { checkBearer, refuseBadToken } from '../lib/auth';
import { getOpenOutage, openOutage, outagesWithCounts, summarise } from '../lib/grid';
import { errors, json, parseBody, refuseCrossSite } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { checkSession } from './auth';

/** Clock skew allowed on admin times; anything later is a typo, not an outage. */
const MAX_FUTURE_MS = 5 * MINUTE_MS;

const isoDate = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString())
  .refine((v) => Date.parse(v) <= Date.now() + MAX_FUTURE_MS, 'time_in_future');

const timerActions = ['punch_out', 'punch_in'] as const satisfies readonly TimerAction[];
const timerSchema = z.object({ action: z.enum(timerActions) });

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

async function listOutages({ db }: RouteContext): Promise<Response> {
  const rows = await outagesWithCounts(db).orderBy(desc(outages.startTime)).limit(50);
  const body: AdminOutagesResponse = {
    outages: rows.map((r) => ({
      ...summarise(r),
      source: r.source,
      isFalsePositive: r.isFalsePositive,
    })),
  };
  return json(body);
}

async function timer({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, timerSchema);
  if ('response' in parsed) return parsed.response;
  const now = new Date().toISOString();

  if (parsed.data.action === 'punch_out') {
    if (!(await openOutage(db, now, 'manual'))) return errors.conflict('outage_already_open');
    return json({ outage: await getOpenOutage(db) }, 201);
  }

  const open = await getOpenOutage(db);
  if (!open) return errors.conflict('no_open_outage');
  const [outage] = await db
    .update(outages)
    .set({ endTime: now })
    .where(and(eq(outages.id, open.id), isNull(outages.endTime)))
    .returning();
  // Closed or deleted by another request in the meantime.
  if (!outage) return errors.conflict('no_open_outage');
  return json({ outage });
}

async function mutateOutage({ request, db }: RouteContext): Promise<Response> {
  const parsed = await parseBody(request, outageSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;

  if (input.action === 'create') {
    if (input.endTime && input.endTime < input.startTime) return errors.badRequest('end_before_start');
    const [outage] = await db
      .insert(outages)
      .values({
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        source: 'manual',
        isPlanned: input.isPlanned ?? false,
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
  if (input.isPlanned !== undefined) changes.isPlanned = input.isPlanned;
  if (input.isFalsePositive !== undefined) {
    changes.isFalsePositive = input.isFalsePositive;
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
 * Admin auth: `Authorization: Bearer <ADMIN_API_TOKEN>` (scripts and AI agents) or, without a
 * bearer header, a session cookie on a same-site request.
 */
async function authorizeAdmin(ctx: RouteContext): Promise<Response | null> {
  const { request, env } = ctx;
  const token = await checkBearer(request, env.ADMIN_API_TOKEN);
  if (token === false) return refuseBadToken(ctx);
  if (token === null) {
    const refused = request.method === 'GET' ? null : refuseCrossSite(request);
    if (refused) return refused;
    if (!(await checkSession(ctx))) return errors.unauthorized();
  }
  return null;
}

export const adminRoutes: Routes = {
  'GET /api/admin/outages': { handler: listOutages, authorize: authorizeAdmin },
  'POST /api/admin/outages': { handler: mutateOutage, authorize: authorizeAdmin, purges: OUTAGE_VIEWS },
  'POST /api/admin/timer': { handler: timer, authorize: authorizeAdmin, purges: OUTAGE_VIEWS },
};
