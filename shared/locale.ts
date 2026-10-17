import { type Locale, site } from '../site.config.ts';

/**
 * Each language's own page: the default locale at /, every other at /<code>/. Used by the build
 * (one HTML file per page), the sitemap and the app; the boot script in index.html repeats the
 * rule, since it has to stay static for its CSP hash.
 */
export const localePath = (locale: Locale) => (locale === site.locales[0] ? '/' : `/${locale}/`);
