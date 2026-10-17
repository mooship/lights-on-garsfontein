import { describe, expect, it } from 'vitest';
import { hashPassword, randomToken, safeEqual, sha256Hex, verifyPassword } from '../worker/lib/crypto';

describe('crypto helpers', () => {
  it('hashes and verifies passwords with a random salt', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$10$abc$def')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2_sha256$999999999$YQ==$YQ==')).toBe(false);
  });

  it('compares strings safely', async () => {
    expect(await safeEqual('token', 'token')).toBe(true);
    expect(await safeEqual('token', 'token2')).toBe(false);
  });

  it('produces hex digests and url-safe tokens', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(randomToken()).toMatch(/^[\w-]{43}$/);
  });
});
