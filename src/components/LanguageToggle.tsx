import type { Component } from 'solid-js';
import { type Locale, locale, setLocale, t } from '../lib/i18n';

/** Shows the other language's code; its name and `lang` are in that language. */
export const LanguageToggle: Component = () => {
  const other = (): Locale => (locale() === 'af' ? 'en' : 'af');
  return (
    <button
      type="button"
      class="gg-icon-button gg-lang-button"
      lang={other()}
      aria-label={t().lang.switchTo}
      title={t().lang.switchTo}
      onClick={() => setLocale(other())}
    >
      {other().toUpperCase()}
    </button>
  );
};
