import { type Component, Show } from 'solid-js';
import { DEFAULT_LOCALE, LOCALES } from '../../shared/locale';
import { locale, switchLocale, t } from '../lib/i18n';

/**
 * Shows the next language's name (with two, simply the other one; with more, it cycles in
 * `site.locales` order); its text, accessible name and `lang` are in that language. Each
 * dictionary's `lang.next` and `lang.switchTo` are those, written in the next language. Hidden
 * with only one locale.
 */
export const LanguageToggle: Component = () => {
  const next = () => LOCALES[(LOCALES.indexOf(locale()) + 1) % LOCALES.length] ?? DEFAULT_LOCALE;
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
