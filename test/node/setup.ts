import { ADMIN_PAGE_PATH } from '../../shared/paths';

// src/lib/i18n.ts reads the page as it loads, and this is as much of a page as it needs. /admin is
// not a language page, so the language is <html lang> until a test calls switchLocale.
Object.assign(globalThis, {
  document: { documentElement: { lang: 'en' } },
  location: { pathname: ADMIN_PAGE_PATH },
  addEventListener: () => {},
});
