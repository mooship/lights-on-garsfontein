import { type Locale, site } from '../site.config.ts';

/**
 * The default locale lives at /, every other at /<code>/. The boot script in index.html repeats
 * this rule (it must stay static for its CSP hash), so change both together.
 */
export const localePath = (locale: Locale) => (locale === site.locales[0] ? '/' : `/${locale}/`);
