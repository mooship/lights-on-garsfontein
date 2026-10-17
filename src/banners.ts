/**
 * Site banners: short, dated notices shown in a bar at the bottom of the public page.
 *
 * To add one, append an entry to `BANNERS` with a new, stable `id` (dismissals are remembered
 * by it), a `from` and `until` with the +02:00 offset (`until` is exclusive), and the copy in
 * both languages. To remove one, delete its entry; expired entries are harmless and stop
 * rendering on their own. At most one banner shows: the first active one not yet dismissed.
 */
import type { Locale } from './lib/i18n';

type Copy = Record<Locale, string>;

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
    from: '2026-10-17T00:00:00+02:00',
    until: '2026-11-05T00:00:00+02:00',
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
