import { site } from '../../site.config';

// No imports beyond the config, so the banners, the tests and the e2e specs can use it too.

export const pad2 = (n: number) => String(n).padStart(2, '0');
const abs = Math.abs(site.utcOffsetMinutes);

/** The configured zone's UTC offset (fixed) as an ISO 8601 suffix, e.g. "+02:00". */
export const OFFSET_SUFFIX = `${site.utcOffsetMinutes < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;

/** Reads a wall-clock time such as "2026-10-17T00:00" in the configured zone: "2026-10-17T00:00+02:00". */
export const zoned = (wall: string) => `${wall}${OFFSET_SUFFIX}`;
