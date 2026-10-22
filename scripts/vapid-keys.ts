// Prints a VAPID_PRIVATE_KEY value: an ECDSA P-256 private key as a one-line JWK.
// Usage: npm run --silent vapid-keys | npx wrangler secret put VAPID_PRIVATE_KEY
import process from 'node:process';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
// No trailing newline when piped, so the secret is exactly the JWK.
const line = JSON.stringify(jwk);
process.stdout.write(process.stdout.isTTY ? `${line}\n` : line);
