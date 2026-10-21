import { type Component, Show } from 'solid-js';
import { LOCALES, nextLocale } from '../../shared/locale';
import { locale, switchLocale, t } from '../lib/i18n';

/**
 * Shows the next language in `site.locales` order, with its text, accessible name and `lang` in that
 * language. Hidden with only one locale.
 */
export const LanguageToggle: Component = () => {
  const next = () => nextLocale(locale());
  return (
    <Show when={LOCALES.length > 1}>
      <button
        type="button"
        class="gg-icon-button gg-lang-button"
        lang={next()}
        aria-label={t().lang.switchTo}
        title={t().lang.switchTo}
        onClick={() => switchLocale(next())}
      >
        {t().lang.next}
      </button>
    </Show>
  );
};
