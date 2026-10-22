import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { site } from '../site.config';
import { fromBase64Url, toBase64Url } from '../worker/lib/crypto';
import {
  buildPushRequest,
  encryptPayload,
  PUSH_TTL_SECONDS,
  type PushTarget,
  vapidAuthorization,
  vapidPublicKey,
} from '../worker/lib/webpush';

const TEST_JWK: JsonWebKey = JSON.parse(env.VAPID_PRIVATE_KEY);

// RFC 8291 appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function senderKeyPair(): Promise<CryptoKeyPair> {
  const point = fromBase64Url(RFC.senderPublic);
  const x = toBase64Url(point.slice(1, 33));
  const y = toBase64Url(point.slice(33, 65));
  const algorithm = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y, d: RFC.senderPrivate },
      algorithm,
      false,
      ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y }, algorithm, true, []),
  };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
}

describe('web push', () => {
  it("encrypts RFC 8291's example exactly", async () => {
    const body = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.receiverPublic, auth: RFC.auth },
      { salt: fromBase64Url(RFC.salt), serverKeys: await senderKeyPair() },
    );
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it('signs a VAPID token the public key verifies', async () => {
    const now = Date.UTC(2026, 9, 22, 12, 0, 0);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', TEST_JWK, now);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match as RegExpExecArray;
    expect(decodePart(head as string)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decodePart(claims as string)).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: site.url,
    });
    expect(k).toBe(vapidPublicKey(TEST_JWK));
    const publicKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(vapidPublicKey(TEST_JWK)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64Url(signature as string),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it('builds a push request with the delivery headers', async () => {
    const target: PushTarget = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: RFC.receiverPublic,
      auth: RFC.auth,
    };
    const request = await buildPushRequest(target, { title: 'Power is off' }, TEST_JWK, Date.now());
    expect(request.method).toBe('POST');
    expect(request.url).toBe(target.endpoint);
    expect(request.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.headers.get('TTL')).toBe(String(PUSH_TTL_SECONDS));
    expect(PUSH_TTL_SECONDS).toBe(3600);
    expect(request.headers.get('Urgency')).toBe('high');
    expect(request.headers.get('Topic')).toBe('power');
    expect(request.headers.get('Authorization')).toMatch(/^vapid t=/);
    expect((await request.arrayBuffer()).byteLength).toBeGreaterThan(86);
  });
});
