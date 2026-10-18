import { createSignal } from 'solid-js';
import { DEFAULT_LOCALE, LOCALES, localePath, pageLocale } from '../../shared/locale';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../i18n';
import { STORAGE_KEYS, writeStored } from './storage';

export type { Locale };

const isLocale = (value: string | null): value is Locale => LOCALES.includes(value as Locale);

// The boot script in index.html has already chosen: the page's own language on a language page,
// English on /admin (src/admin/copy.ts), the stored choice elsewhere, without storing anything.
// The browser language is not consulted.
const lang = document.documentElement.lang;
const initial = isLocale(lang) ? lang : DEFAULT_LOCALE;
const [locale, setLocaleSignal] = createSignal<Locale>(initial);

const page = pageLocale(location.pathname);
/** True while the boot script sends / on to the stored language's page: render nothing meanwhile. */
export const leaving = page !== undefined && page !== initial;
// Opening a language's page, from a link or a search result, is choosing it.
if (page === initial) writeStored(STORAGE_KEYS.locale, initial);

export { locale };

/** The active dictionary: `t().status.ON`. */
export const t = () => DICTIONARIES[locale()];

export const intlLocale = () => site.intlLocales[locale()];

function setLocale(next: Locale): void {
  document.documentElement.lang = next;
  setLocaleSignal(next);
  writeStored(STORAGE_KEYS.locale, next);
}

/**
 * The language switch. On a language's page the URL moves to the other page too, in place: the
 * shell already holds every language, so there is nothing to reload. Elsewhere only the
 * language changes.
 */
export function switchLocale(next: Locale): void {
  if (pageLocale(location.pathname)) history.pushState(null, '', localePath(next));
  setLocale(next);
}

// Back and forward between the language pages bring their language with them.
addEventListener('popstate', () => {
  const next = pageLocale(location.pathname);
  if (next) setLocale(next);
});
