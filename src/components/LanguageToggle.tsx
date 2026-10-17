import type { Component } from 'solid-js';
import { setLocale, t } from '../lib/i18n';

/** Shows the other language's code; its name and `lang` are in that language. */
export const LanguageToggle: Component = () => (
  <button
    type="button"
    class="gg-icon-button gg-lang-button"
    lang={t().lang.target}
    aria-label={t().lang.switchTo}
    title={t().lang.switchTo}
    onClick={() => setLocale(t().lang.target)}
  >
    {t().lang.label}
  </button>
);
