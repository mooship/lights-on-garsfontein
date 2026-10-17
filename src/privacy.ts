import { api } from './lib/api';
import { getTurnstileToken } from './lib/turnstile';

// The privacy page's "Show email address" button. The address is the Worker's CONTACT_EMAIL
// secret and is fetched only after a Turnstile check, so it is never in the HTML or this bundle.
// Without JavaScript the blocks stay hidden and the GitHub link is the way to get in touch.

/** POST /api/contact: the address, or null when the deploy has none (404 not_configured). */
async function fetchEmail(token: string): Promise<string | null> {
  const res = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => ({}))) as { email?: unknown };
  if (!res.ok || typeof body.email !== 'string') throw new Error(`contact_${res.status}`);
  return body.email;
}

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
      const email = await fetchEmail(await getTurnstileToken(widget, turnstileSiteKey, 'contact'));
      if (email === null) {
        // Nothing to retry: the button goes, and focus moves to the GitHub link that replaces it.
        const link = fallBack();
        button.parentElement?.remove();
        link.focus();
        return;
      }
      const mail = document.createElement('a');
      mail.href = `mailto:${email}`;
      mail.textContent = email;
      button.replaceWith(mail);
      mail.focus();
    } catch {
      // A failed check or network error: offer GitHub, and leave the button to try again.
      fallBack();
    } finally {
      busy = false;
      button.removeAttribute('aria-disabled');
    }
  });

  block.hidden = false;
}

for (const block of document.querySelectorAll<HTMLElement>('[data-contact]')) setUp(block);
