/**
 * Site banners: short, dated notices shown in a bar at the bottom of the public page.
 *
 * To add one, append an entry to `BANNERS` with a new, stable `id` (dismissals are remembered
 * by it), a `from` and `until` in the configured zone via `zoned` (`until` is exclusive), and the
 * copy. Copy is required in the default locale (`site.locales[0]`) and optional in the others,
 * which fall back to the default's text. To remove one, delete its entry; expired entries are
 * harmless and stop rendering on their own. At most one banner shows: the first active one not
 * yet dismissed.
 */
import type { Locale, site } from '../site.config';
import { zoned } from './lib/zone';

type Copy = Record<(typeof site.locales)[0], string> & Partial<Record<Locale, string>>;

export interface Banner {
  id: string;
  from: string;
  until: string;
  text: Copy;
  link?: { href: string; label: Copy };
}

export const BANNERS: readonly Banner[] = [
  {
    id: 'vote-2026-11-04',
    from: zoned('2026-10-17T00:00'),
    until: zoned('2026-11-05T00:00'),
    text: {
      af: 'Die plaaslike regeringsverkiesing vind op Woensdag 4 November 2026 plaas. Kyk of jy geregistreer is en waar jou stemlokaal is.',
      en: 'Local government elections take place on Wednesday 4 November 2026. Check your registration and voting station.',
    },
    link: {
      href: 'https://www.elections.org.za/pw/Voter/Voter-Information',
      label: { af: 'Kiesersinligting by die OVK', en: 'Voter information from the IEC' },
    },
  },
];

/** Whether any banner is showing at `now` (ms) or still to come. */
export const bannersPending = (now: number, banners: readonly Banner[] = BANNERS) =>
  banners.some((b) => now < Date.parse(b.until));

/** The banners showing at `now` (ms), in their listed order. */
export function activeBanners(now: number, banners: readonly Banner[] = BANNERS): Banner[] {
  return banners.filter((b) => Date.parse(b.from) <= now && now < Date.parse(b.until));
}
