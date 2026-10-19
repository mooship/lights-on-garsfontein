import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { site } from '../../site.config';
import { HEAD } from '../../src/i18n/head';
import { DICTIONARIES } from '../../src/i18n/index';

// Public copy never says how an outage was recorded: residents should not weigh a reading by its
// source. Only the admin page names it, and its copy is outside the dictionaries (src/admin/copy.ts).
const RECORDING_METHOD = /sensor|by hand|manual|voeler|handmatig|met die hand/i;

/** Every string in `node`, with message functions called on sample arguments, keyed by path. */
function strings(node: unknown, path: string): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') return strings(node('x', 'x', 'x', 'x'), path);
  if (Array.isArray(node)) return node.flatMap((item, i) => strings(item, `${path}.${i}`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

describe('public copy', () => {
  for (const locale of site.locales) {
    // The day is `day.today`, `day.yesterday` or `day.on(…)` ("op Sa. 17 Okt."), so each sentence
    // must read with a phrase that brings its own preposition.
    it(`reads naturally with an older day in the status sentences (${locale})`, () => {
      const m = DICTIONARIES[locale];
      const day = m.day.on('Sat 17 Oct');
      for (const sentence of [m.status.wentOff('14:05', day), m.status.planned('14:05', day)]) {
        expect(sentence).not.toMatch(/\b(sedert|since) (op|on)\b/);
      }
    });

    it(`never says how an outage was recorded (${locale})`, () => {
      const all = [...strings(DICTIONARIES[locale], locale), ...strings(HEAD[locale], `head.${locale}`)];
      expect(all.length).toBeGreaterThan(50);
      expect(all.filter(([, text]) => RECORDING_METHOD.test(text))).toEqual([]);
    });
  }
});

describe('public static files', () => {
  // These ship as-is to every visitor and crawler, outside the dictionaries.
  for (const file of [
    'templates/llms.txt',
    'templates/site.webmanifest',
    'templates/.well-known/security.txt',
    'index.html',
    'privacy.html',
    '404.html',
  ]) {
    it(`never says how an outage was recorded (${file})`, () => {
      const text = readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8');
      expect(text.split('\n').filter((line) => RECORDING_METHOD.test(line))).toEqual([]);
    });
  }
});
