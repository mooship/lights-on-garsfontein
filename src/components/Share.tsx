import { type Component, createSignal, Show } from 'solid-js';
import { localePath } from '../../shared/locale';
import { site } from '../../site.config';
import { locale, t } from '../lib/i18n';
import { button } from '../styles/ui.css';
import * as css from './Share.css';

/** The page in the language being read, so whoever opens the link gets that language too. */
const shareUrl = () => `${site.url}${localePath(locale())}`;

const encode = encodeURIComponent;

/** The two most used messaging apps here; Signal has no web share link, but the system sheet covers it. */
const whatsappHref = (text: string, url: string) => `https://wa.me/?text=${encode(`${text} ${url}`)}`;
const telegramHref = (text: string, url: string) => `https://t.me/share/url?url=${encode(url)}&text=${encode(text)}`;

/**
 * "Share with neighbours": the system share sheet where there is one (phones), plus direct WhatsApp
 * and Telegram links. Without a share sheet (most desktops) "Copy link" takes its place. Plain text
 * buttons: no app logos.
 */
export const Share: Component = () => {
  const canShare = typeof navigator.share === 'function';
  // A key, so the message follows a language switch.
  const [result, setResult] = createSignal<'copied' | 'copyFailed' | null>(null);
  const message = () => {
    const key = result();
    return key ? t().share[key] : '';
  };

  async function copy() {
    setResult(null);
    try {
      await navigator.clipboard.writeText(shareUrl());
      setResult('copied');
    } catch {
      setResult('copyFailed');
    }
  }

  async function share() {
    setResult(null);
    try {
      // The link goes in the text, not `url`: several targets, such as Copy on Windows and Android, keep
      // only the text and would drop it.
      await navigator.share({ title: site.brand.full, text: `${t().share.text} ${shareUrl()}` });
    } catch (error) {
      // Closing the share sheet is not a failure; anything else falls back to copying.
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copy();
    }
  }

  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

  return (
    <div>
      <div class={css.actions}>
        <Show
          when={canShare}
          fallback={
            <button type="button" class={button.ghost} onClick={copy}>
              {t().share.copy}
            </button>
          }
        >
          <button type="button" class={button.ghost} onClick={share}>
            {t().share.button}
          </button>
        </Show>
        <a
          class={`${button.ghost} ${css.link}`}
          href={whatsappHref(t().share.text, shareUrl())}
          aria-label={`${t().share.whatsapp} ${t().share.newTab}`}
          {...external}
        >
          WhatsApp
        </a>
        <a
          class={`${button.ghost} ${css.link}`}
          href={telegramHref(t().share.text, shareUrl())}
          aria-label={`${t().share.telegram} ${t().share.newTab}`}
          {...external}
        >
          Telegram
        </a>
      </div>
      <p class={css.status} aria-live="polite">
        {message()}
      </p>
    </div>
  );
};
