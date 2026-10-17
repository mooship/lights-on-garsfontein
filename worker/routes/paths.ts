// The edge-cached routes (`edgeCache` in lib/router.ts). Each is a view of the outages.

export const STATUS_PATH = '/api/status';
export const STATS_PATH = '/api/stats';
export const CSV_PATH = '/api/outages.csv';
export const FEED_PATH = '/feed.xml';

/** A write that opens, closes or changes an outage purges all of these. */
export const OUTAGE_VIEWS: readonly string[] = [STATUS_PATH, STATS_PATH, CSV_PATH, FEED_PATH];
