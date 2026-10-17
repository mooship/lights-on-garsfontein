import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { DAY_MS } from '../../shared/api';
import { sessions } from '../db/schema';
import { randomToken, safeEqual, sha256Hex, verifyPassword } from '../lib/crypto';
import { errors, isRateLimited, json, parseBody } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { checkTurnstile } from '../lib/turnstile';

// __Host- prefix: the browser only accepts it from this exact host (no sibling-subdomain cookie tossing).
const SESSION_COOKIE = '__Host-admin_session';
const SESSION_TOKEN = /^[\w-]{43}$/;
// Stay signed in for 30 days after the last visit; renewing at most daily keeps writes rare.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_MS = DAY_MS;
const ADMIN_USER_ID = 'admin';

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
  token: z.string().min(1).max(2048),
});

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

const sessionExpiry = (now: number) => new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();

/**
 * True when the request carries a valid, unexpired session cookie. Sessions slide: once a
 * day of the 30 has been used, the expiry and the cookie are pushed back out to 30 days.
 */
export async function checkSession({ request, db, headers }: RouteContext): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  // Skip the database for anything that cannot be one of our tokens.
  if (!token || !SESSION_TOKEN.test(token)) return false;
  const id = await sha256Hex(token);
  const now = Date.now();
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), gt(sessions.expiresAt, new Date(now).toISOString())),
  });
  if (!session) return false;
  if (Date.parse(session.expiresAt) < now + SESSION_TTL_SECONDS * 1000 - RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: sessionExpiry(now) })
      .where(eq(sessions.id, id));
    headers.append('Set-Cookie', sessionCookie(token, SESSION_TTL_SECONDS));
  }
  return true;
}

async function login(ctx: RouteContext): Promise<Response> {
  const { request, env, db } = ctx;
  const parsed = await parseBody(request, loginSchema);
  if ('response' in parsed) return parsed.response;
  // A site-wide cap on top of the per-connection limit, so spreading guesses over many
  // addresses does not help either.
  if (await isRateLimited(env.LOGIN_GLOBAL_LIMITER, 'login')) return errors.rateLimited();
  // Turnstile keeps bots off the sign-in form; scripts use ADMIN_API_TOKEN instead.
  const refused = await checkTurnstile(ctx, parsed.data.token, 'login');
  if (refused) return refused;
  // Check both before answering, and give the same answer either way, so neither the
  // response nor its timing reveals whether the username was right.
  const { username, password } = parsed.data;
  const [userOk, passwordOk] = await Promise.all([
    env.ADMIN_USERNAME ? safeEqual(username.trim().toLowerCase(), env.ADMIN_USERNAME.toLowerCase()) : false,
    env.ADMIN_PASSWORD_HASH ? verifyPassword(password, env.ADMIN_PASSWORD_HASH) : false,
  ]);
  if (!userOk || !passwordOk) return errors.unauthorized();

  const token = randomToken();
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: ADMIN_USER_ID,
    expiresAt: sessionExpiry(Date.now()),
  });
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function logout({ request, db }: RouteContext): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

export const authRoutes: Routes = {
  'POST /api/admin/login': { handler: login, sameOrigin: true, limiter: 'LOGIN_LIMITER' },
  'POST /api/admin/logout': { handler: logout, sameOrigin: true },
};
