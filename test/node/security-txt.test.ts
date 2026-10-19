import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../shared/api';
import { site } from '../../site.config';

describe('security.txt', () => {
  // Fails a month ahead, so renewing the date is a deliberate review rather than a silent lapse.
  it('stays valid for at least 30 more days, and at most a year, as RFC 9116 asks', () => {
    const expires = Date.parse(site.securityTxtExpires);
    expect(expires - Date.now()).toBeGreaterThan(30 * DAY_MS);
    expect(expires - Date.now()).toBeLessThan(365 * DAY_MS);
  });
});
