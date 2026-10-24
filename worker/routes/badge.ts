import { type BadgeState, badgeState, MINUTE_MS } from '../../shared/api';
import { badgePath } from '../../shared/paths';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../../src/i18n/index';
import { PALETTE } from '../../src/styles/palette';
import { getGridState } from '../lib/grid';
import { publicCache } from '../lib/http';
import type { RouteContext, Routes } from '../lib/router';
import { escapeXml } from '../lib/xml';
import { STATUS_EDGE_TTL_SECONDS } from './status';

const HEIGHT = 20;
const PAD = 8;
// The embedding page picks the font, so text is stretched to a width estimated from its length
// (textLength) rather than measured: it can never overflow its box.
const CHAR_WIDTH = 6.5;

const FILL: Record<BadgeState, string> = {
  ON: PALETTE.light.on,
  OFF: PALETTE.light.off,
  NONE: PALETTE.light.muted,
};

function svg(label: string, value: string, state: BadgeState): string {
  const labelWidth = Math.round(label.length * CHAR_WIDTH);
  const valueWidth = Math.round(value.length * CHAR_WIDTH);
  const split = labelWidth + 2 * PAD;
  const width = split + valueWidth + 2 * PAD;
  const title = escapeXml(`${label}: ${value}`);
  const text = (x: number, length: number, content: string) =>
    `<text x="${x}" y="14" textLength="${length}" lengthAdjust="spacingAndGlyphs">${escapeXml(content)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}"><title>${title}</title><rect width="${split}" height="${HEIGHT}" fill="${PALETTE.light.text}"/><rect x="${split}" width="${width - split}" height="${HEIGHT}" fill="${FILL[state]}"/><g fill="${PALETTE.light.card}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">${text(PAD, labelWidth, label)}${text(split + PAD, valueWidth, value)}</g></svg>`;
}

/** The status as an image for other sites, worded as the page words it (`badgeState`). */
const badge =
  (locale: Locale) =>
  async ({ db }: RouteContext): Promise<Response> => {
    const { status, monitored } = await getGridState(db, new Date());
    const state = badgeState(status, monitored);
    return new Response(svg(site.brand.full, DICTIONARIES[locale].status[state], state), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': publicCache(MINUTE_MS),
        // Embedded on other sites; the Worker's default, same-site, would stop browsers showing it.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  };

export const badgeRoutes: Routes = Object.fromEntries(
  site.locales.map((locale) => [
    `GET ${badgePath(locale)}`,
    { handler: badge(locale), limiter: 'STATUS_LIMITER', cors: true, edgeCache: STATUS_EDGE_TTL_SECONDS },
  ]),
);
