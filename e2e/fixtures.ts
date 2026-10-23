import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';
import { type AdminOutagesResponse, DAY_MS, MINUTE_MS, OUTAGE_ACTION } from '../shared/api';
import { ADMIN_OUTAGES_PATH } from '../shared/paths';
import type { Locale } from '../site.config';
import { POLL_MS } from '../src/lib/poll';
import { STORAGE_KEYS } from '../src/lib/storage';
import { exampleVar } from './dev-vars';

export { expect };

export const ADMIN_API = { Authorization: `Bearer ${exampleVar('ADMIN_API_TOKEN')}` };

/**
 * Deletes every outage through the admin API. The sensor heartbeat cannot be reset this way, so the
 * tests never post one: a live reading would turn "No outage reported" into ON for every later test.
 * A test that needs one mocks the status response instead.
 */
async function deleteOutages(request: APIRequestContext): Promise<void> {
  for (;;) {
    const list = await request.get(ADMIN_OUTAGES_PATH, { headers: ADMIN_API });
    expect(list.status()).toBe(200);
    const { outages } = (await list.json()) as AdminOutagesResponse;
    if (outages.length === 0) return;
    const deleted = await Promise.all(
      outages.map(({ id }) =>
        request.post(ADMIN_OUTAGES_PATH, { headers: ADMIN_API, data: { action: OUTAGE_ACTION.delete, id } }),
      ),
    );
    for (const res of deleted) expect(res.status()).toBe(200);
  }
}

/** Lets a poll's interval pass, so the page asks again; the test installs the clock before loading the page. */
export const pollNow = (page: Page) => page.clock.fastForward(POLL_MS);

/** Serves the real response from `path`, changed by `change`. */
export const patchJson = <T>(page: Page, path: string, change: (body: T) => T) =>
  page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: change((await response.json()) as T) });
  });

/** Logs a half-hour outage that started `daysAgo` days ago; returns its id. */
export async function logOutage(request: APIRequestContext, daysAgo: number): Promise<number> {
  const start = Date.now() - daysAgo * DAY_MS;
  const res = await request.post(ADMIN_OUTAGES_PATH, {
    headers: ADMIN_API,
    data: {
      action: OUTAGE_ACTION.create,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 30 * MINUTE_MS).toISOString(),
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { outage: { id: number } }).outage.id;
}

/** Stores `value` under `key` in localStorage before every load of `page`. */
export const storeBeforeLoad = (page: Page, key: string, value: string) =>
  page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, value] as const);

/** Stores the app's language before every load of `page` (the app's own default is site.locales[0]). */
export const withLocale = (page: Page, locale: Locale) => storeBeforeLoad(page, STORAGE_KEYS.locale, locale);

/** Makes every load of `page` a return visit, which the alerts card waits for. */
export const returningVisitor = (page: Page) => storeBeforeLoad(page, STORAGE_KEYS.visits, '1');

/** Whether the page scrolls sideways, once its fonts have painted. */
export const scrollsSideways = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });

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
  // The skeleton has no table; the loaded card has one or two.
  await expect(page.locator('.gg-trends-details table').first()).toBeAttached();
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (window as unknown as ShiftWindow).__readCls();
  });
}
