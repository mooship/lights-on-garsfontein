import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import { sessions } from '../db/schema';
import { randomToken, sha256Hex, verifyPassword } from '../lib/crypto';
import { clientIp, errors, isCrossOrigin, isRateLimited, json, parseBody } from '../lib/http';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_USER_ID = 'admin';

const loginSchema = z.object({ password: z.string().min(1).max(256) });

function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Returns the session's user id when the request carries a valid, unexpired session cookie. */
export async function getSessionUser(request: Request, env: Env): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const session = await createDb(env.DB).query.sessions.findFirst({
    where: and(eq(sessions.id, id), gt(sessions.expiresAt, new Date().toISOString())),
  });
  return session?.userId ?? null;
}

async function login(request: Request, env: Env): Promise<Response> {
  if (isCrossOrigin(request)) return errors.forbidden();
  if (await isRateLimited(env.LOGIN_LIMITER, clientIp(request))) return errors.rateLimited();
  const parsed = await parseBody(request, loginSchema);
  if ('response' in parsed) return parsed.response;
  if (!env.ADMIN_PASSWORD_HASH || !(await verifyPassword(parsed.data.password, env.ADMIN_PASSWORD_HASH))) {
    return errors.unauthorized();
  }

  const token = randomToken();
  await createDb(env.DB)
    .insert(sessions)
    .values({
      id: await sha256Hex(token),
      userId: ADMIN_USER_ID,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    });
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (isCrossOrigin(request)) return errors.forbidden();
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await createDb(env.DB)
      .delete(sessions)
      .where(eq(sessions.id, await sha256Hex(token)));
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

export async function handleAuthRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case 'POST /api/admin/login':
      return login(request, env);
    case 'POST /api/admin/logout':
      return logout(request, env);
    default:
      return null;
  }
}
