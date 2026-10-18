import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';
import type { AdminOutagesResponse } from '../shared/api';
import type { Locale } from '../site.config';
import { exampleVar } from './dev-vars';

export { expect };

const ADMIN_API = { Authorization: `Bearer ${exampleVar('ADMIN_API_TOKEN')}` };

/** Deletes every outage through the admin API. */
async function deleteOutages(request: APIRequestContext): Promise<void> {
  for (;;) {
    const list = await request.get('/api/admin/outages', { headers: ADMIN_API });
    expect(list.status()).toBe(200);
    const { outages } = (await list.json()) as AdminOutagesResponse;
    if (outages.length === 0) return;
    for (const { id } of outages) {
      const res = await request.post('/api/admin/outages', { headers: ADMIN_API, data: { action: 'delete', id } });
      expect(res.status()).toBe(200);
    }
  }
}

/** Stores the app's language before every load of `page` (the app's own default is site.locales[0]). */
export const withLocale = (page: Page, locale: Locale) =>
  page.addInitScript((l) => localStorage.setItem('locale', l), locale);

/**
 * Every test starts with no outages, as the tests share one database. Rate-limit counts carry
 * over: the admin API cannot clear them.
 *
 * Most tests read the English copy; a block opts into another language with
 * test.use({ appLocale: 'af' }). Pages from browser.newContext() don't get it: pass them to withLocale.
 */
export const test = base.extend<{ appLocale: Locale; resetOutages: undefined }>({
  resetOutages: [
    async ({ request }, use) => {
      await deleteOutages(request);
      await use(undefined);
    },
    { auto: true },
  ],
  appLocale: ['en', { option: true }],
  page: async ({ page, appLocale }, use) => {
    await withLocale(page, appLocale);
    await use(page);
  },
});

type ShiftWindow = Window & { __readCls: () => number };

/** Sums the page's layout shifts from the start of its load; call it before `goto`. */
export const trackLayoutShift = (page: Page) =>
  page.addInitScript(() => {
    let cls = 0;
    const add = (entries: PerformanceEntryList) => {
      for (const entry of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    };
    const observer = new PerformanceObserver((list) => add(list.getEntries()));
    observer.observe({ type: 'layout-shift', buffered: true });
    // takeRecords picks up shifts the observer has not been called back with yet.
    (window as unknown as ShiftWindow).__readCls = () => {
      add(observer.takeRecords());
      return cls;
    };
  });

/** The layout shift so far, once the status and statistics have rendered and the fonts have painted. */
export async function readLayoutShift(page: Page): Promise<number> {
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('.gg-trends-details table')).toBeAttached(); // the skeleton has no table
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (window as unknown as ShiftWindow).__readCls();
  });
}
