// The Worker's crons, apart from worker/index.ts so tests can import them: a Worker entry module
// should export only its handlers. They must match `[triggers] crons` in wrangler.toml.

/** Outage detection. */
export const MINUTE_CRON = '* * * * *';
/** Housekeeping: purges expired admin sessions. */
export const HOURLY_CRON = '0 * * * *';
