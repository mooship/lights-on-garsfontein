// localStorage can be unavailable (private mode, blocked site data): reads fall back to null and
// writes are dropped, so whatever they back still works for this visit.

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
  } catch {}
}

/** A remembered yes/no, stored as '1'. */
export const isFlagged = (key: string) => readStored(key) === '1';
export const setFlag = (key: string) => writeStored(key, '1');
