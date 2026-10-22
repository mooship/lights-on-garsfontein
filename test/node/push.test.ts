import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../shared/api';
import { ALERTS_SNOOZE_MS, base64UrlToBytes, type PushEnv, pushSupport, shouldOfferCard } from '../../src/lib/push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

/** A browser as pushSupport sees it; `standalone` is how the home-screen app is detected on iOS. */
function env(options: { ua: string; serviceWorker?: boolean; pushManager?: boolean; standalone?: boolean }): PushEnv {
  return {
    window: {
      ...(options.pushManager ? { PushManager: class {} } : {}),
      matchMedia: () => ({ matches: false }),
    },
    navigator: {
      userAgent: options.ua,
      ...(options.serviceWorker === false ? {} : { serviceWorker: {} }),
      ...(options.standalone ? { standalone: true } : {}),
    },
  };
}

describe('pushSupport', () => {
  it('asks an iPhone in the browser to install the site first', () => {
    expect(pushSupport(env({ ua: IPHONE }))).toBe('ios-install');
  });

  it('supports an iPhone opened from the home screen', () => {
    expect(pushSupport(env({ ua: IPHONE, standalone: true, pushManager: true }))).toBe('supported');
  });

  it('detects the home-screen app by display mode too', () => {
    const standalone = env({ ua: IPHONE, pushManager: true });
    standalone.window.matchMedia = () => ({ matches: true });
    expect(pushSupport(standalone)).toBe('supported');
  });

  it('treats an iPad that reports a Mac like an iPhone', () => {
    const ipad = env({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' });
    ipad.navigator.maxTouchPoints = 5;
    expect(pushSupport(ipad)).toBe('ios-install');
  });

  it('supports a desktop with a service worker and push', () => {
    expect(pushSupport(env({ ua: DESKTOP, pushManager: true }))).toBe('supported');
  });

  it('does not support a desktop without a service worker', () => {
    expect(pushSupport(env({ ua: DESKTOP, serviceWorker: false, pushManager: true }))).toBe('unsupported');
  });

  it('does not support a browser without push', () => {
    expect(pushSupport(env({ ua: DESKTOP }))).toBe('unsupported');
  });
});

describe('shouldOfferCard', () => {
  const now = 1_000_000;
  const offer = { visits: 2, snoozedUntil: null, declined: false, state: 'off' as const, now };

  it('waits for a second visit', () => {
    expect(shouldOfferCard({ ...offer, visits: 1 })).toBe(false);
    expect(shouldOfferCard(offer)).toBe(true);
  });

  it('also offers the install steps on iOS', () => {
    expect(shouldOfferCard({ ...offer, state: 'ios-install' })).toBe(true);
  });

  it('offers nothing when alerts are on, blocked or unsupported', () => {
    for (const state of ['on', 'blocked', 'unsupported'] as const) {
      expect(shouldOfferCard({ ...offer, state }), state).toBe(false);
    }
  });

  it('stays away once declined', () => {
    expect(shouldOfferCard({ ...offer, declined: true })).toBe(false);
  });

  it('stays away while snoozed and returns after', () => {
    expect(shouldOfferCard({ ...offer, snoozedUntil: now + 1 })).toBe(false);
    expect(shouldOfferCard({ ...offer, snoozedUntil: now - 1 })).toBe(true);
  });

  it('snoozes for thirty days', () => {
    expect(ALERTS_SNOOZE_MS).toBe(30 * DAY_MS);
  });
});

describe('base64UrlToBytes', () => {
  it('decodes the unpadded URL alphabet', () => {
    // 0xfb 0xff 0xfe is "-__-" in base64url and "+//+" in base64.
    expect([...base64UrlToBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...base64UrlToBytes('AQI')]).toEqual([1, 2]);
  });
});
