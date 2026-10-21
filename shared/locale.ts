import { type Locale, site } from '../site.config.ts';

/**
 * The default locale lives at /, every other at /<code>/. The boot script in index.html repeats
 * this rule (it must stay static for its CSP hash), so change both together.
 */
export const localePath = (locale: Locale) => (locale === site.locales[0] ? '/' : `/${locale}/`);

export const LOCALES: readonly Locale[] = site.locales;
export const DEFAULT_LOCALE = site.locales[0];

/** The language the switch offers from `locale`: the next in `site.locales`, wrapping round. */
export const nextLocale = (locale: Locale) => LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] ?? locale;

/** The locale whose own page `path` is (/ or /<code>/), if any. */
export const pageLocale = (path: string) => LOCALES.find((locale) => localePath(locale) === path);
