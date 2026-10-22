import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushSupport, shouldOfferCard } from '../../src/lib/push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

/** Stands in for the browser pushSupport reads; `standalone` and `displayStandalone` are the two ways iOS marks the home-screen app. */
function browser(options: {
  ua: string;
  serviceWorker?: boolean;
  pushManager?: boolean;
  standalone?: boolean;
  displayStandalone?: boolean;
  maxTouchPoints?: number;
}) {
  vi.stubGlobal('window', {
    ...(options.pushManager ? { PushManager: class {} } : {}),
    matchMedia: () => ({ matches: options.displayStandalone === true }),
  });
  vi.stubGlobal('navigator', {
    userAgent: options.ua,
    maxTouchPoints: options.maxTouchPoints ?? 0,
    ...(options.serviceWorker === false ? {} : { serviceWorker: {} }),
    ...(options.standalone ? { standalone: true } : {}),
  });
}

describe('pushSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks an iPhone in the browser to install the site first', () => {
    browser({ ua: IPHONE });
    expect(pushSupport()).toBe('ios-install');
  });

  it('supports an iPhone opened from the home screen', () => {
    browser({ ua: IPHONE, standalone: true, pushManager: true });
    expect(pushSupport()).toBe('supported');
  });

  it('detects the home-screen app by display mode too', () => {
    browser({ ua: IPHONE, pushManager: true, displayStandalone: true });
    expect(pushSupport()).toBe('supported');
  });

  it('treats an iPad that reports a Mac like an iPhone', () => {
    browser({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      maxTouchPoints: 5,
    });
    expect(pushSupport()).toBe('ios-install');
  });

  it('supports a desktop with a service worker and push', () => {
    browser({ ua: DESKTOP, pushManager: true });
    expect(pushSupport()).toBe('supported');
  });

  it('does not support a desktop without a service worker', () => {
    browser({ ua: DESKTOP, serviceWorker: false, pushManager: true });
    expect(pushSupport()).toBe('unsupported');
  });

  it('does not support a browser without push', () => {
    browser({ ua: DESKTOP });
    expect(pushSupport()).toBe('unsupported');
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
});
