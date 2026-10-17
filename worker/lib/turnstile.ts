const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(secret: string, token: string, remoteIp: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', remoteIp);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}
