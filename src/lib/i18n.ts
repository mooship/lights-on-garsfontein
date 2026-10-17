import { createSignal } from 'solid-js';
import { type Locale, site } from '../../site.config';
import { DICTIONARIES } from '../i18n';
import { readStored, writeStored } from './storage';

export type { Locale };

const STORAGE_KEY = 'locale';

export const LOCALES: readonly Locale[] = site.locales;
export const DEFAULT_LOCALE = site.locales[0];

const isLocale = (value: string | null): value is Locale => LOCALES.includes(value as Locale);

// The default unless the visitor picked another configured language before; the browser
// language is not consulted.
const stored = readStored(STORAGE_KEY);
const [locale, setLocaleSignal] = createSignal<Locale>(isLocale(stored) ? stored : DEFAULT_LOCALE);

export { locale };

/** The active dictionary: `t().status.ON`. */
export const t = () => DICTIONARIES[locale()];

/** The locale for Intl formatters. */
export const intlLocale = () => site.intlLocales[locale()];

export function setLocale(next: Locale): void {
  document.documentElement.lang = next;
  setLocaleSignal(next);
  writeStored(STORAGE_KEY, next);
}
