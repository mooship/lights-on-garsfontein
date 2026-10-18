import { MINUTE_MS, UTC_OFFSET_MS } from '../../shared/api';

// No imports beyond shared/api, so the banners, the tests and the e2e specs can use it too.

export const pad2 = (n: number) => String(n).padStart(2, '0');
const abs = Math.abs(UTC_OFFSET_MS) / MINUTE_MS;

/** The configured zone's UTC offset (fixed) as an ISO 8601 suffix, e.g. "+02:00". */
const OFFSET_SUFFIX = `${UTC_OFFSET_MS < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;

/** Reads a wall-clock time such as "2026-10-17T00:00" in the configured zone: "2026-10-17T00:00+02:00". */
export const zoned = (wall: string) => `${wall}${OFFSET_SUFFIX}`;
