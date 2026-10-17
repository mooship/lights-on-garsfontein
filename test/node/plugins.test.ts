import { describe, expect, it } from 'vitest';
import { escapeHtml, fill, fillStaticI18n, jsonString, localeVisibilityCss } from '../../build/html';
import { site } from '../../site.config';
import { DICTIONARIES } from '../../src/i18n';

describe('escaping', () => {
  it('escapes text for HTML attributes and content', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry's&lt;/a&gt;");
  });

  it('escapes text for inside a JSON string in a <script>', () => {
    expect(jsonString('say "hi"\n</script>')).toBe('say \\"hi\\"\\n\\u003c/script>');
  });
});

describe('fill', () => {
  it('fills site values, lists and the tracking start for where they land', () => {
    expect(fill('<b>%site.brand.full%</b>', 'html', 'f')).toBe(`<b>${escapeHtml(site.brand.full)}</b>`);
    expect(fill('%site.locales%', 'html', 'f')).toBe(site.locales.join(' '));
    expect(fill('%since.en% / %since.af%', 'text', 'f')).toBe('17 October 2026 / 17 Oktober 2026');
    const json = JSON.parse(fill('{"name": "%site.brand.full%", "inLanguage": %site.locales%}', 'json', 'f'));
    expect(json).toEqual({ name: site.brand.full, inLanguage: site.locales });
  });

  it('fails the build on an unknown, malformed or misplaced placeholder', () => {
    expect(() => fill('%site.nope%', 'html', 'f')).toThrow('unknown placeholder %site.nope%');
    expect(() => fill('%site.area%', 'html', 'f')).toThrow('unknown placeholder %site.area%'); // an object
    expect(() => fill('%since.zu%', 'html', 'f')).toThrow('%since.zu% names a locale that is not in');
    expect(() => fill('%site.brand.full', 'html', 'index.html')).toThrow(
      'malformed placeholder %site.brand.full in index.html',
    );
    expect(() => fill('{"l": "%site.locales%"}', 'json', 'm.json')).toThrow('m.json is not valid JSON');
  });
});

describe('fillStaticI18n', () => {
  it('fills an element with one copy per locale', () => {
    const spans = site.locales
      .map((l) => `<span data-l="${l}" lang="${l}">${escapeHtml(DICTIONARIES[l].trends.title)}</span>`)
      .join('');
    expect(fillStaticI18n('<h2 class="t" data-i18n="trends.title"></h2>')).toBe(`<h2 class="t">${spans}</h2>`);
  });

  it('passes site values to message functions', () => {
    const html = fillStaticI18n('<p data-i18n="scope.measured" data-i18n-args="site.landmark"></p>');
    for (const l of site.locales) expect(html).toContain(escapeHtml(DICTIONARIES[l].scope.measured(site.landmark)));
  });

  it('repeats a labelled element per locale, and labels the switch with the next language', () => {
    const buttons = site.locales.map((l, i) => {
      const next = site.locales[(i + 1) % site.locales.length] ?? l;
      const label = escapeHtml(DICTIONARIES[l].lang.switchTo);
      return `<button disabled data-l="${l}" lang="${next}" aria-label="${label}">${DICTIONARIES[l].lang.next}</button>`;
    });
    expect(fillStaticI18n('<button disabled data-i18n-switch data-i18n-label="lang.switchTo"></button>')).toBe(
      buttons.join(''),
    );
  });

  it('fails the build on an unknown key or a marked element that is not empty', () => {
    expect(() => fillStaticI18n('<p data-i18n="nope.key"></p>')).toThrow('nope.key is not a string');
    expect(() => fillStaticI18n('<p data-i18n="trends.title">Stats</p>')).toThrow('is not empty');
  });
});

describe('localeVisibilityCss', () => {
  it('hides every copy but the one for <html lang>, defaulting to the first locale', () => {
    expect(localeVisibilityCss(['af', 'en'])).toBe(
      'html[lang="en"] [data-l="af"],\nhtml:not([lang="en"]) [data-l="en"] {\n  display: none;\n}',
    );
    expect(localeVisibilityCss(['af'])).toBe('');
  });
});
