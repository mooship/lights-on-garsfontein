import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { site } from '../../site.config';
import { HEAD } from '../../src/i18n/head';
import { DICTIONARIES } from '../../src/i18n/index';

// Public copy never says how an outage was recorded: residents should not weigh a reading by its
// source. Only the admin pages name the source.
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
    it(`never says how an outage was recorded (${locale})`, () => {
      const { admin: _admin, ...publicCopy } = DICTIONARIES[locale];
      const all = [...strings(publicCopy, locale), ...strings(HEAD[locale], `head.${locale}`)];
      expect(all.length).toBeGreaterThan(100);
      expect(all.filter(([, text]) => RECORDING_METHOD.test(text))).toEqual([]);
    });
  }
});

describe('public static files', () => {
  // These ship as-is to every visitor and crawler, outside the dictionaries.
  for (const file of ['templates/llms.txt', 'templates/site.webmanifest', 'index.html', 'privacy.html']) {
    it(`never says how an outage was recorded (${file})`, () => {
      const text = readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8');
      expect(text.split('\n').filter((line) => RECORDING_METHOD.test(line))).toEqual([]);
    });
  }
});
