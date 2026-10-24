import { BADGE_STATES, type BadgeState, badgeState, MINUTE_MS } from '../../shared/api';
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

const textWidth = (text: string) => Math.round(text.length * CHAR_WIDTH);

/** `valueBox` fits the locale's longest state, so a page showing the badge never shifts when it changes. */
function svg(label: string, value: string, state: BadgeState, valueBox: number): string {
  const split = textWidth(label) + 2 * PAD;
  const width = split + valueBox;
  const title = escapeXml(`${label}: ${value}`);
  const text = (x: number, content: string) =>
    `<text x="${x}" y="14" textLength="${textWidth(content)}" lengthAdjust="spacingAndGlyphs">${escapeXml(content)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}"><title>${title}</title><rect width="${split}" height="${HEIGHT}" fill="${PALETTE.light.text}"/><rect x="${split}" width="${valueBox}" height="${HEIGHT}" fill="${FILL[state]}"/><g fill="${PALETTE.light.card}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">${text(PAD, label)}${text(split + (valueBox - textWidth(value)) / 2, value)}</g></svg>`;
}

/** The status as an image for other sites, worded as the page words it (`badgeState`). */
const badge = (locale: Locale) => {
  const words = DICTIONARIES[locale].status;
  const valueBox = Math.max(...BADGE_STATES.map((s) => textWidth(words[s]))) + 2 * PAD;
  return async ({ db }: RouteContext): Promise<Response> => {
    const { status, monitored } = await getGridState(db, new Date());
    const state = badgeState(status, monitored);
    return new Response(svg(site.brand.full, words[state], state, valueBox), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // README, Show the status on your site, states the lag this adds to the edge copy; change both.
        'Cache-Control': publicCache(MINUTE_MS),
        // Embedded on other sites; the Worker's default, same-site, would stop browsers showing it.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  };
};

export const badgeRoutes: Routes = Object.fromEntries(
  site.locales.map((locale) => [
    `GET ${badgePath(locale)}`,
    { handler: badge(locale), limiter: 'STATUS_LIMITER', cors: true, edgeCache: STATUS_EDGE_TTL_SECONDS },
  ]),
);
