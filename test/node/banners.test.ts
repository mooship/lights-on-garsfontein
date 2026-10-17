import { describe, expect, it } from 'vitest';
import { activeBanners, type Banner, bannersPending } from '../../src/banners';
import { zoned } from '../../src/lib/zone';

const banner = (id: string, from: string, until: string): Banner => ({
  id,
  from: zoned(from),
  until: zoned(until),
  text: { af: id, en: id },
});

const first = banner('first', '2026-11-01T00:00', '2026-11-05T00:00');
const second = banner('second', '2026-11-03T00:00', '2026-11-10T00:00');
const BANNERS = [first, second];
const at = (wall: string) => Date.parse(zoned(wall));

describe('activeBanners', () => {
  it('shows each banner from its start until, not including, its end', () => {
    const ids = (wall: string) => activeBanners(at(wall), BANNERS).map((b) => b.id);
    expect(ids('2026-10-31T23:59:59')).toEqual([]);
    expect(ids('2026-11-01T00:00:00')).toEqual(['first']);
    expect(ids('2026-11-04T23:59:59')).toEqual(['first', 'second']); // in their listed order
    expect(ids('2026-11-05T00:00:00')).toEqual(['second']);
    expect(ids('2026-11-10T00:00:00')).toEqual([]);
  });
});

describe('bannersPending', () => {
  it('is true while any banner is showing or still to come', () => {
    expect(bannersPending(at('2026-10-01T00:00'), BANNERS)).toBe(true);
    expect(bannersPending(at('2026-11-09T23:59:59'), BANNERS)).toBe(true);
    expect(bannersPending(at('2026-11-10T00:00'), BANNERS)).toBe(false);
    expect(bannersPending(at('2026-10-01T00:00'), [])).toBe(false);
  });
});
