import { type Component, Show } from 'solid-js';
import { DEFAULT_LOCALE, LOCALES, locale, setLocale, t } from '../lib/i18n';

/**
 * Shows the next language's code (with two, simply the other one; with more, it cycles in
 * `site.locales` order); its name and `lang` are in that language. Each dictionary's
 * `lang.switchTo` is that label, written in the next language. Hidden with only one locale.
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
        onClick={() => setLocale(next())}
      >
        {next().toUpperCase()}
      </button>
    </Show>
  );
};
