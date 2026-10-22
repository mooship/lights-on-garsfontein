// No cloudflare:test import, so the e2e tests can share it.

/** A subscription's receiver keys from RFC 8291 appendix A: the Worker accepts them, and a real payload can be encrypted to them. */
export const RFC8291_RECEIVER_KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
} as const;
