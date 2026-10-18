// Imports nothing and uses no Worker globals, so the Node e2e suite can import it too.

/** __Host- prefix: the browser only accepts it from this exact host (no sibling-subdomain cookie tossing). */
export const SESSION_COOKIE = '__Host-admin_session';
