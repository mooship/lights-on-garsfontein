// localStorage can be unavailable (private mode, blocked site data): reads fall back to null and
// writes are dropped, so whatever they back still works for this visit.

/**
 * Every key the site keeps in web storage. The boot scripts in index.html and privacy.html read
 * `theme` and `locale` by name and must stay static (CSP hash), so change them together.
 */
export const STORAGE_KEYS = {
  theme: 'theme',
  locale: 'locale',
  /** sessionStorage: when a missing chunk last reloaded the page (src/index.tsx). */
  chunkReload: 'chunk-reload',
} as const;

/** Set once the visitor has closed the banner with this id. */
export const bannerDismissedKey = (id: string) => `banner-dismissed:${id}`;

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Unavailable: the choice lasts only for this visit.
  }
}

/** A remembered yes/no, stored as '1'. */
export const isFlagged = (key: string) => readStored(key) === '1';
export const setFlag = (key: string) => writeStored(key, '1');
