// The string work behind the build's plugins in vite.config.ts, kept apart from Vite so
// test/node/plugins.test.ts can run it.

import { DEFAULT_LOCALE, LOCALES, nextLocale } from '../shared/locale.ts';
import { site } from '../site.config.ts';
import { DICTIONARIES } from '../src/i18n/index.ts';

/** For HTML text and double-quoted attributes; single quotes are left alone. */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `text` as the inside of a JSON string, with < escaped so it cannot close a <script>. */
export const jsonString = (text: string) => JSON.stringify(text).slice(1, -1).replace(/</g, '\\u003c');

/** How `fill` escapes a value: for HTML, inside a JSON string, or not at all. */
type Mode = 'html' | 'json' | 'text';

/** The value behind a placeholder name: `site.<path>` or `since.<locale>`. */
function placeholder(name: string): string | readonly string[] {
  const [scope, ...path] = name.split('.');
  if (scope === 'since' && path.length === 1) {
    const intl = (site.intlLocales as Record<string, string>)[path[0] ?? ''];
    if (!intl) throw new Error(`site-config: %${name}% names a locale that is not in site.intlLocales`);
    const format = { day: 'numeric', month: 'long', year: 'numeric', timeZone: site.timeZone } as const;
    return new Intl.DateTimeFormat(intl, format).format(new Date(site.trackingSince));
  }
  const value =
    scope === 'site'
      ? path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], site)
      : undefined;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new Error(`site-config: unknown placeholder %${name}%`);
}

/**
 * Fills %site.<path>% (a value from site.config.ts; a list is space-separated, or a JSON array
 * in JSON) and %since.<locale>% (site.trackingSince as a long date in that locale). Escaped for
 * where it lands; anything else that looks like one of these fails the build.
 */
export function fill(text: string, mode: Mode, file: string): string {
  const out = text.replace(/%((?:site|since)\.[\w.-]+)%/g, (_match, name: string) => {
    const value = placeholder(name);
    if (mode === 'json') {
      return Array.isArray(value) ? JSON.stringify(value).replace(/</g, '\\u003c') : jsonString(value as string);
    }
    const plain = Array.isArray(value) ? value.join(' ') : (value as string);
    return mode === 'html' ? escapeHtml(plain) : plain;
  });
  const leftover = /%(?:site|since)\.[\w.-]*%?/.exec(out);
  if (leftover) throw new Error(`site-config: malformed placeholder ${leftover[0]} in ${file}`);
  if (mode === 'json') {
    try {
      JSON.parse(out);
    } catch (error) {
      throw new Error(`site-config: ${file} is not valid JSON once filled (a list goes outside quotes)`, {
        cause: error,
      });
    }
  }
  return out;
}

/** A string from the dictionaries, or a message function's result for `args`. */
function message(dict: object, key: string, args: readonly string[] = []): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);
  const text = typeof value === 'function' ? (value as (...a: readonly string[]) => unknown)(...args) : value;
  if (typeof text !== 'string') throw new Error(`static-i18n: ${key} is not a string in the dictionaries`);
  return escapeHtml(text);
}

/** The values for data-i18n-args: space-separated `site.<path>` names, each a string. */
function messageArgs(names: string | undefined): string[] {
  return (names ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => {
      const value = placeholder(name);
      if (typeof value !== 'string') throw new Error(`static-i18n: ${name} is not a string in site.config.ts`);
      return value;
    });
}

const marked = /<([a-z][\w-]*)(\s[^>]*?\bdata-i18n[^>]*)>\s*<\/\1>/g;
const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * Fills the data-i18n elements of `html` from the dictionaries, once per locale in site.locales
 * (see staticI18n in vite.config.ts). On an empty element:
 * - data-i18n="key" fills it with a <span data-l> per locale.
 * - data-i18n-label="key" (an aria-label) repeats the whole element per locale instead,
 *   with data-i18n as its text.
 * - data-i18n-args="site.landmark ..." passes those site.config.ts values to a message that is a
 *   function, such as scope.measured.
 * - data-i18n-switch marks the language switch (src/components/LanguageToggle.tsx): each copy
 *   shows the next locale's name (`lang.next`; with two, the other one), with lang set to that
 *   locale. With one locale there is no switch.
 */
export function fillStaticI18n(html: string): string {
  const out = html.replace(marked, (_element, tag: string, attrs: string) => {
    const text = attr(attrs, 'data-i18n');
    const label = attr(attrs, 'data-i18n-label');
    const args = messageArgs(attr(attrs, 'data-i18n-args'));
    const isSwitch = /\sdata-i18n-switch\b/.test(attrs);
    if (isSwitch && LOCALES.length === 1) return '';
    const rest = attrs.replace(/\sdata-i18n(?:-label|-args)?="[^"]*"|\sdata-i18n-switch\b/g, '');
    const copies = LOCALES.map((locale) => {
      const dict = DICTIONARIES[locale];
      return {
        locale,
        lang: isSwitch ? nextLocale(locale) : locale,
        text: isSwitch ? message(dict, 'lang.next') : text ? message(dict, text, args) : '',
        label: label && message(dict, label),
      };
    });
    if (label) {
      return copies
        .map((c) => `<${tag}${rest} data-l="${c.locale}" lang="${c.lang}" aria-label="${c.label}">${c.text}</${tag}>`)
        .join('');
    }
    const spans = copies.map((c) => `<span data-l="${c.locale}" lang="${c.lang}">${c.text}</span>`).join('');
    return `<${tag}${rest}>${spans}</${tag}>`;
  });
  if (/\sdata-i18n[\w-]*[=\s>]/.test(out)) throw new Error('static-i18n: a data-i18n element is not empty');
  return out;
}

/**
 * The CSS that shows only the shell copy for <html lang>, for every locale in `locales` (the first
 * is the default, which shows unless lang is another of them). Empty with one locale.
 */
export function localeVisibilityCss(locales: readonly string[] = LOCALES): string {
  const [first = DEFAULT_LOCALE, ...others] = locales;
  const selectors = [
    ...others.map((locale) => `html[lang="${locale}"] [data-l="${first}"]`),
    ...others.map((locale) => `html:not([lang="${locale}"]) [data-l="${locale}"]`),
  ];
  return selectors.length ? `${selectors.join(',\n')} {\n  display: none;\n}` : '';
}
