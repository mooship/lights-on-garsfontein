import { createSignal } from 'solid-js';
import { af, type Messages } from '../i18n/af';
import { en } from '../i18n/en';

export type Locale = 'af' | 'en';

const STORAGE_KEY = 'locale';
const MESSAGES: Record<Locale, Messages> = { af, en };

// Afrikaans unless the visitor picked English before; the browser language is not consulted.
function storedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'af';
  } catch {
    return 'af';
  }
}

const [locale, setLocaleSignal] = createSignal<Locale>(storedLocale());

export { locale };

/** The active dictionary: `t().status.ON`. */
export const t = () => MESSAGES[locale()];

/** The locale for Intl formatters. */
export const intlLocale = () => (locale() === 'af' ? 'af-ZA' : 'en-ZA');

export function setLocale(next: Locale): void {
  document.documentElement.lang = next;
  setLocaleSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the switch still works for this visit.
  }
}
