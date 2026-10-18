/** A request under this that no route matches gets the Worker's JSON 404, not the app's page. */
export const API_PREFIX = '/api/';

export const STATUS_PATH = '/api/status';
export const STATS_PATH = '/api/stats';
export const CSV_PATH = '/api/outages.csv';
export const FEED_PATH = '/feed.xml';
export const HEARTBEAT_PATH = '/api/heartbeat';
export const CONTACT_PATH = '/api/contact';

export const ADMIN_API_PREFIX = '/api/admin/';
export const LOGIN_PATH = '/api/admin/login';
export const LOGOUT_PATH = '/api/admin/logout';
export const ADMIN_OUTAGES_PATH = '/api/admin/outages';
export const TIMER_PATH = '/api/admin/timer';

export const SITEMAP_PATH = '/sitemap.xml';
export const ROBOTS_PATH = '/robots.txt';
export const OG_IMAGE_PATH = '/og.png';

/** The boot script in index.html repeats this as a literal (it must stay static); change both together. */
export const ADMIN_PAGE_PATH = '/admin';
export const PRIVACY_PAGE_PATH = '/privacy';

/**
 * Worker routes outside API_PREFIX. wrangler.toml and wrangler.example.toml list them again in
 * `assets.run_worker_first`, which cannot import this; change them together.
 */
export const WORKER_PAGES: readonly string[] = [SITEMAP_PATH, ROBOTS_PATH, OG_IMAGE_PATH, FEED_PATH];

/** A write that opens, closes or changes an outage purges all of these. */
export const OUTAGE_VIEWS: readonly string[] = [STATUS_PATH, STATS_PATH, CSV_PATH, FEED_PATH];
