import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CREDENTIAL_MAX_LENGTH, DAY_MS, SECOND_MS, TURNSTILE_ACTION } from '../../shared/api';
import { LOGIN_PATH, LOGOUT_PATH } from '../../shared/paths';
import { sessions } from '../db/schema';
import { SESSION_COOKIE } from '../lib/cookies';
import { randomToken, safeEqual, sha256Hex, verifyPassword } from '../lib/crypto';
import { errors, isRateLimited, json, parseBody } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { checkTurnstile, turnstileToken } from '../lib/turnstile';

/** The shape of randomToken()'s output. */
const SESSION_TOKEN = /^[\w-]{43}$/;
/** A session ends this long after it was last renewed. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** Renewing at most this often keeps session writes rare. */
const RENEW_AFTER_MS = DAY_MS;
/** However often it is used, a session ends this long after sign-in. */
const SESSION_MAX_AGE_MS = 90 * DAY_MS;
/** The single admin account's id in `sessions.user_id`. */
export const ADMIN_USER_ID = 'admin';

const loginSchema = z.object({
  username: z.string().min(1).max(CREDENTIAL_MAX_LENGTH.username),
  password: z.string().min(1).max(CREDENTIAL_MAX_LENGTH.password),
  token: turnstileToken,
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

/** SESSION_TTL_MS from now, capped at SESSION_MAX_AGE_MS after sign-in. */
const sessionExpiry = (now: number, createdAt: number) =>
  Math.min(now + SESSION_TTL_MS, createdAt + SESSION_MAX_AGE_MS);

/** Changes whenever ADMIN_PASSWORD_HASH does, so a new password signs every session out. */
export const passwordFingerprint = async (env: Env) =>
  (await sha256Hex(`session:${env.ADMIN_PASSWORD_HASH}`)).slice(0, 16);

/**
 * True when the request carries a valid, unexpired session cookie. Sessions slide: once
 * RENEW_AFTER_MS has passed, the expiry and the cookie (via `ctx.headers`) are pushed back out to
 * SESSION_TTL_MS, up to SESSION_MAX_AGE_MS after sign-in. Expired sessions, and those signed in
 * under another password, are deleted.
 */
export async function checkSession({ request, env, db, headers }: RouteContext): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  // Skip the database for anything that cannot be one of our tokens.
  if (!token || !SESSION_TOKEN.test(token)) return false;
  const id = await sha256Hex(token);
  const now = Date.now();
  const [session, fingerprint] = await Promise.all([
    db.query.sessions.findFirst({ where: eq(sessions.id, id) }),
    passwordFingerprint(env),
  ]);
  if (!session) return false;
  const createdAt = Date.parse(session.createdAt);
  const expiresAt = Date.parse(session.expiresAt);
  if (session.passwordFingerprint !== fingerprint || !(expiresAt > now) || !(createdAt + SESSION_MAX_AGE_MS > now)) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return false;
  }
  const renewed = sessionExpiry(now, createdAt);
  if (expiresAt < renewed - RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(renewed).toISOString() })
      .where(eq(sessions.id, id));
    headers.append('Set-Cookie', sessionCookie(token, Math.floor((renewed - now) / SECOND_MS)));
  }
  return true;
}

async function login(ctx: RouteContext): Promise<Response> {
  const { request, env, db } = ctx;
  const parsed = await parseBody(request, loginSchema);
  if ('response' in parsed) return parsed.response;
  // Turnstile keeps bots off the sign-in form; scripts use ADMIN_API_TOKEN instead.
  const refused = await checkTurnstile(ctx, parsed.data.token, TURNSTILE_ACTION.login);
  if (refused) return refused;
  // A site-wide cap on top of the per-connection limit, so spreading guesses over many
  // addresses does not help either. Counted only after Turnstile, so junk cannot lock out sign-in.
  if (await isRateLimited(env.LOGIN_GLOBAL_LIMITER, 'login')) return errors.rateLimited();
  // Check both before answering, and give the same answer either way, so neither the
  // response nor its timing reveals whether the username was right.
  const { username, password } = parsed.data;
  const [userOk, passwordOk] = await Promise.all([
    env.ADMIN_USERNAME ? safeEqual(username.trim().toLowerCase(), env.ADMIN_USERNAME.toLowerCase()) : false,
    env.ADMIN_PASSWORD_HASH ? verifyPassword(password, env.ADMIN_PASSWORD_HASH) : false,
  ]);
  if (!userOk || !passwordOk) return errors.unauthorized();

  const token = randomToken();
  const now = Date.now();
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: ADMIN_USER_ID,
    expiresAt: new Date(sessionExpiry(now, now)).toISOString(),
    createdAt: new Date(now).toISOString(),
    passwordFingerprint: await passwordFingerprint(env),
  });
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / SECOND_MS) });
}

async function logout({ request, db }: RouteContext): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

export const authRoutes: Routes = {
  [`POST ${LOGIN_PATH}`]: { handler: login, limiter: 'LOGIN_LIMITER' },
  [`POST ${LOGOUT_PATH}`]: { handler: logout },
};
