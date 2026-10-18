/**
 * The `error` field of every API error response. A new code needs a message in `admin.errors`
 * (src/admin/copy.ts), or a place in `Unexplained` there if the admin page never meets it.
 */
export const ERROR = {
  badRequest: 'bad_request',
  invalidJson: 'invalid_json',
  endBeforeStart: 'end_before_start',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  turnstileFailed: 'turnstile_failed',
  notFound: 'not_found',
  notConfigured: 'not_configured',
  outageAlreadyOpen: 'outage_already_open',
  noOpenOutage: 'no_open_outage',
  unsupportedMediaType: 'unsupported_media_type',
  rateLimited: 'rate_limited',
  internal: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR)[keyof typeof ERROR];
