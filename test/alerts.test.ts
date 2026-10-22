import { describe, expect, it } from 'vitest';
import { site } from '../site.config';
import { DICTIONARIES } from '../src/i18n/index';
import { ALERT_KINDS, alertMessage } from '../worker/lib/alerts';

const { af, en } = DICTIONARIES;

const off = { startTime: '2026-10-22T12:02:00Z', endTime: null, isPlanned: false };
const back = { ...off, endTime: '2026-10-22T14:15:00Z' };

describe('alertMessage', () => {
  it('says when the power went off, in local time', () => {
    const { body } = alertMessage('off', off, 'en');

    expect(body).toBe(en.push.off.body('14:02'));
    expect(body).toContain('14:02');
    // One literal smoke string per language.
    expect(body).toBe('No power in Garsfontein Ext 16 since 14:02.');
    expect(alertMessage('off', off, 'af').body).toBe('Geen krag in Garsfontein Uitb. 16 sedert 14:02 nie.');
  });

  it('uses the planned wording for planned outages', () => {
    const message = alertMessage('off', { ...off, isPlanned: true }, 'en');

    expect(message.title).toBe(en.push.planned.title);
    expect(message.body).toBe(en.push.planned.body('14:02'));
  });

  it('says when it came back and for how long', () => {
    expect(alertMessage('on', back, 'en').body).toBe(en.push.on.body('16:15', '2 h 13 min'));
    expect(alertMessage('on', back, 'af').body).toBe(af.push.on.body('16:15', '2 u 13 min'));
  });

  it('shows minutes only for a short outage and drops a zero remainder', () => {
    const short = { ...off, endTime: '2026-10-22T12:09:00Z' };
    const whole = { ...off, endTime: '2026-10-22T14:02:00Z' };

    expect(alertMessage('on', short, 'en').body).toBe(en.push.on.body('14:09', '7 min'));
    expect(alertMessage('on', whole, 'en').body).toBe(en.push.on.body('16:02', '2 h'));
  });

  it("speaks the subscriber's language", () => {
    const afrikaans = alertMessage('off', off, 'af');
    const english = alertMessage('off', off, 'en');

    expect(afrikaans.title).toBe(af.push.off.title);
    expect(afrikaans.lang).toBe('af');
    expect(afrikaans.url).toBe(`${site.url}/`);
    expect(english.title).toBe(en.push.off.title);
    expect(english.lang).toBe('en');
    expect(english.url).toBe(`${site.url}/en/`);
  });

  it('uses one tag', () => {
    for (const kind of ALERT_KINDS) expect(alertMessage(kind, back, 'en').tag).toBe('power');
  });
});
