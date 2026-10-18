import { TURNSTILE_ACTION } from '../shared/api';
import { ERROR } from '../shared/errors';
import { ApiError, api } from './lib/api';
import { getTurnstileToken } from './lib/turnstile';

// The privacy page's "Show email address" button. The address is the Worker's CONTACT_EMAIL
// secret and is fetched only after a Turnstile check, so it is never in the HTML or this bundle.
// Without JavaScript the blocks stay hidden and the GitHub link is the way to get in touch.

function setUp(block: HTMLElement): void {
  const button = block.querySelector<HTMLButtonElement>('.contact-reveal');
  const widget = block.querySelector<HTMLElement>('.contact-widget');
  const result = block.querySelector<HTMLElement>('.contact-result');
  const github = block.closest('section')?.querySelector<HTMLAnchorElement>('[data-contact-github]');
  if (!button || !widget || !result || !github) return;
  let busy = false;

  /** Announces the GitHub route in the live region; returns its link. */
  const fallBack = () => {
    const link = github.cloneNode(true) as HTMLAnchorElement;
    link.removeAttribute('data-contact-github');
    result.replaceChildren(`${block.dataset.fallback ?? ''} `, link);
    return link;
  };

  button.addEventListener('click', async () => {
    if (busy) return;
    // aria-disabled rather than disabled, so the button keeps focus while the check runs.
    busy = true;
    button.setAttribute('aria-disabled', 'true');
    result.replaceChildren();
    try {
      const { turnstileSiteKey } = await api.status();
      const { email } = await api.contact(await getTurnstileToken(widget, turnstileSiteKey, TURNSTILE_ACTION.contact));
      const mail = document.createElement('a');
      mail.href = `mailto:${email}`;
      mail.textContent = email;
      button.replaceWith(mail);
      mail.focus();
    } catch (e) {
      if (e instanceof ApiError && e.code === ERROR.notConfigured) {
        // The deploy has no address, so there is nothing to retry: the button goes, and focus
        // moves to the GitHub link that replaces it.
        const link = fallBack();
        button.parentElement?.remove();
        link.focus();
      } else {
        // A failed check or network error: offer GitHub, and leave the button to try again.
        fallBack();
      }
    } finally {
      busy = false;
      button.removeAttribute('aria-disabled');
    }
  });

  block.hidden = false;
}

for (const block of document.querySelectorAll<HTMLElement>('[data-contact]')) setUp(block);
