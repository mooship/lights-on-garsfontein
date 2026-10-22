import { HOUR_MS } from '../../shared/api';
import { site } from '../../site.config';
import { fromBase64Url, toBase64Url } from './crypto';

export interface PushTarget {
  endpoint: string;
  /** Base64url, the subscription's receiver public key. */
  p256dh: string;
  /** Base64url, the subscription's auth secret. */
  auth: string;
}

/** How long a push service may hold a message for an offline device; a stale outage alert misleads. */
export const PUSH_TTL_SECONDS = 3600;

const encoder = new TextEncoder();

// RFC 8188: one record is enough, so the record size only has to exceed the payload.
const RECORD_SIZE = 4096;
const SALT_BYTES = 16;
/** Marks the last (here the only) record, with no padding after it. */
const LAST_RECORD_DELIMITER = 0x02;
const VAPID_EXP_MS = 12 * HOUR_MS;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The `aes128gcm` body of RFC 8291: the RFC 8188 header (salt, record size, sender key), then one record. */
export async function encryptPayload(
  plaintext: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { salt: Uint8Array; serverKeys: CryptoKeyPair },
): Promise<Uint8Array> {
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const serverKeys =
    fixed?.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const serverPublic = new Uint8Array((await crypto.subtle.exportKey('raw', serverKeys.publicKey)) as ArrayBuffer);
  const receiverPublic = fromBase64Url(target.p256dh);
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // The runtime takes the standard `public`; the Workers types only declare it as `$public`.
      { name: 'ECDH', public: receiverKey } as SubtleCryptoDeriveKeyAlgorithm,
      serverKeys.privateKey,
      256,
    ),
  );

  const keyInfo = concat(encoder.encode('WebPush: info\0'), receiverPublic, serverPublic);
  const ikm = await hkdf(fromBase64Url(target.auth), sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(plaintext, new Uint8Array([LAST_RECORD_DELIMITER])),
    ),
  );

  const header = new Uint8Array(SALT_BYTES + 4 + 1);
  header.set(salt);
  new DataView(header.buffer).setUint32(SALT_BYTES, RECORD_SIZE);
  header[SALT_BYTES + 4] = serverPublic.length;
  return concat(header, serverPublic, record);
}

/** The uncompressed P-256 point (`0x04 || x || y`) in base64url, which is what a browser's `applicationServerKey` takes. */
export function vapidPublicKey(privateJwk: JsonWebKey): string {
  const { x, y } = privateJwk;
  // A malformed key would otherwise yield a plausible-looking string that no browser can subscribe with.
  if (!x || !y) throw new Error('VAPID key has no public coordinates');
  return toBase64Url(concat(new Uint8Array([0x04]), fromBase64Url(x), fromBase64Url(y)));
}

/** Builds RFC 8292 `Authorization` header values for the push service at an endpoint; `now` is in milliseconds. */
export type VapidSigner = (endpoint: string, now: number) => Promise<string>;

/** A signer that imports the key once, so a page of sends does not import it for every subscription. */
export async function vapidSigner(privateJwk: JsonWebKey): Promise<VapidSigner> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicKey = vapidPublicKey(privateJwk);
  const part = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  return async (endpoint, now) => {
    const signingInput = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
      aud: new URL(endpoint).origin,
      exp: Math.floor((now + VAPID_EXP_MS) / 1000),
      sub: site.url,
    })}`;
    // WebCrypto returns the raw r || s pair, which is the JWS form of ES256.
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
    return `vapid t=${signingInput}.${toBase64Url(new Uint8Array(signature))}, k=${publicKey}`;
  };
}

/** The `Authorization` header value of RFC 8292 for the push service at `endpoint`; `now` is in milliseconds. */
export async function vapidAuthorization(endpoint: string, privateJwk: JsonWebKey, now: number): Promise<string> {
  return (await vapidSigner(privateJwk))(endpoint, now);
}

/** A ready-to-send push request; `now` is in milliseconds, and `authorization`, if given, is reused rather than signed again. */
export async function buildPushRequest(
  target: PushTarget,
  payload: object,
  privateJwk: JsonWebKey,
  now: number,
  authorization?: string,
): Promise<Request> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), target);
  return new Request(target.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(PUSH_TTL_SECONDS),
      // Without it a phone in battery-saver may defer the alert until the power is back.
      Urgency: 'high',
      // A newer message with the same topic replaces one a push service still holds.
      Topic: 'power',
      Authorization: authorization ?? (await vapidAuthorization(target.endpoint, privateJwk, now)),
    },
    body,
  });
}
