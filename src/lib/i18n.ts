import { createSignal } from 'solid-js';
import { af, type Messages } from '../i18n/af';
import { en } from '../i18n/en';
import { readStored, writeStored } from './storage';

export type Locale = 'af' | 'en';

const STORAGE_KEY = 'locale';
const MESSAGES: Record<Locale, Messages> = { af, en };

// Afrikaans unless the visitor picked English before; the browser language is not consulted.
const [locale, setLocaleSignal] = createSignal<Locale>(readStored(STORAGE_KEY) === 'en' ? 'en' : 'af');

export { locale };

/** The active dictionary: `t().status.ON`. */
export const t = () => MESSAGES[locale()];

/** The locale for Intl formatters. */
export const intlLocale = () => (locale() === 'af' ? 'af-ZA' : 'en-ZA');

export function setLocale(next: Locale): void {
  document.documentElement.lang = next;
  setLocaleSignal(next);
  writeStored(STORAGE_KEY, next);
}
