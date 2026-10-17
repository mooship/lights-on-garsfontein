import { describe, expect, it } from 'vitest';
import { call, mockTurnstile, sameWindow } from './helpers';

// A file of its own: each test file gets its own limiter state, and any other sign-in in the same
// minute would use up part of the cap.

/** A sign-in attempt from a new address each time, so the per-address limit never applies. */
const attempt = (password: string) =>
  call('/api/admin/login', { method: 'POST', body: { username: 'admin', password, token: 'turnstile-token' } });

describe('site-wide sign-in cap', () => {
  it('allows 30 attempts a minute across all addresses, counting only those that pass Turnstile', async () => {
    await sameWindow();
    mockTurnstile(false, 'login');
    for (let i = 0; i < 35; i++) expect((await attempt('nope')).status).toBe(403);
    mockTurnstile(true, 'login');
    for (let i = 0; i < 30; i++) expect((await attempt('nope')).status).toBe(401);
    // Even the right password is refused once the cap is reached.
    expect((await attempt('test-password')).status).toBe(429);
  });
});
