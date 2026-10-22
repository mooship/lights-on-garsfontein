import type { Page } from '@playwright/test';
import { LOCALES, localePath } from '../shared/locale';
import { ADMIN_PAGE_PATH, PUSH_SUBSCRIPTION_PATH } from '../shared/paths';
import { admin } from '../src/admin/copy';
import { DICTIONARIES } from '../src/i18n';
import { ALERTS_OFFER_DELAY_MS, ALERTS_SNOOZE_MS } from '../src/lib/push';
import { STORAGE_KEYS } from '../src/lib/storage';
import { expect, test } from './fixtures';

/** Where the fake push manager keeps its subscription, so it outlives a reload as a real one does. */
const FAKE_SUBSCRIBED = 'e2e-push-subscribed';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** The fake push service's address for this browser, on a host the Worker accepts. */
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e';

/**
 * The test server cannot reach a real push service, and the test browser denies notifications
 * whatever it is granted, so both are faked: notifications are allowed unless `permission` says
 * otherwise, and the push manager hands out a fake subscription. `subscribed` starts with one.
 */
const fakePush = (page: Page, { subscribed = false, permission = 'granted' as NotificationPermission } = {}) =>
  page.addInitScript(
    ([key, endpoint, startOn, allowed]) => {
      if (startOn && localStorage.getItem(key) === null) localStorage.setItem(key, '1');
      Object.defineProperty(Notification, 'permission', { get: () => allowed });
      Notification.requestPermission = async () => allowed;
      const fake = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4', auth: 'tBHItJI5svbpez7K' } }),
        unsubscribe: async () => {
          localStorage.removeItem(key);
          return true;
        },
      });
      PushManager.prototype.subscribe = async () => {
        localStorage.setItem(key, '1');
        return fake() as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async () =>
        (localStorage.getItem(key) ? fake() : null) as unknown as PushSubscription | null;
    },
    [FAKE_SUBSCRIBED, ENDPOINT, subscribed, permission] as const,
  );

type Call = { method: string; body: Record<string, unknown> };

/** Answers the subscription endpoint as the Worker would, and records each call. */
async function recordSubscriptionCalls(page: Page, status = 204): Promise<Call[]> {
  const calls: Call[] = [];
  await page.route(`**${PUSH_SUBSCRIPTION_PATH}`, (route) => {
    const request = route.request();
    calls.push({ method: request.method(), body: request.postDataJSON() });
    return route.fulfill({ status });
  });
  return calls;
}

/** Makes every load of `page` a return visit. */
const returning = (page: Page) =>
  page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, '1');
  }, STORAGE_KEYS.visits);

for (const locale of LOCALES) {
  const m = DICTIONARIES[locale].alerts;

  test.describe(`alerts (${locale})`, () => {
    test.use({ appLocale: locale });

    test.beforeEach(async ({ page }) => {
      await page.clock.install();
    });

    const bell = (page: Page) => page.getByRole('button', { name: m.bell.label, exact: true });
    const card = (page: Page) => page.getByRole('dialog', { name: m.card.heading });

    /** Loads the page and lets the moment pass after which the card may offer itself. */
    async function load(page: Page) {
      await page.goto(localePath(locale));
      await expect(page.getByRole('status')).toBeVisible();
      await expect(bell(page)).toBeEnabled();
      await page.clock.runFor(ALERTS_OFFER_DELAY_MS);
    }

    test('does not offer alerts on a first visit', async ({ page }) => {
      await fakePush(page);
      await load(page);
      await page.clock.runFor(ALERTS_OFFER_DELAY_MS);
      await expect(card(page)).not.toBeVisible();
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('offers alerts on a return visit and subscribes on tap', async ({ page }) => {
      await fakePush(page);
      const calls = await recordSubscriptionCalls(page);
      await page.goto(localePath(locale));
      await expect(page.getByRole('status')).toBeVisible();
      await page.reload();
      await expect(page.getByRole('status')).toBeVisible();
      // Not while the moment after loading lasts: the card never interrupts the first look.
      await expect(card(page)).not.toBeVisible();
      await page.clock.runFor(ALERTS_OFFER_DELAY_MS);
      await expect(card(page)).toBeVisible();
      await expect(card(page).getByRole('heading', { name: m.card.heading })).toBeFocused();
      await expect(card(page)).toContainText(m.card.body);
      await expect(card(page)).toContainText(m.card.scope);
      // Same page and language as the footer's privacy link.
      const footerHref = await page
        .getByRole('link', { name: DICTIONARIES[locale].footer.privacy })
        .getAttribute('href');
      await expect(card(page).getByRole('link', { name: m.card.privacy })).toHaveAttribute('href', footerHref ?? '');

      await card(page).getByRole('button', { name: m.card.turnOn }).click();
      await expect(card(page)).not.toBeVisible();
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(m.card.turnedOn)).toBeVisible();
      expect(calls).toEqual([{ method: 'POST', body: expect.objectContaining({ locale }) }]);
    });

    test('says so when turning on fails, and can try again', async ({ page }) => {
      await fakePush(page);
      await returning(page);
      await recordSubscriptionCalls(page, 500);
      await load(page);
      const turnOn = card(page).getByRole('button', { name: m.card.turnOn });
      await turnOn.click();
      await expect(card(page)).toContainText(m.card.failed);
      await expect(turnOn).toBeEnabled();
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('Not now hides the card for the snooze period', async ({ page }) => {
      await fakePush(page);
      await returning(page);
      await load(page);
      await card(page).getByRole('button', { name: m.card.notNow }).click();
      await expect(card(page)).not.toBeVisible();

      await load(page);
      await expect(card(page)).not.toBeVisible();

      await page.evaluate(([key, until]) => localStorage.setItem(key, String(until)), [
        STORAGE_KEYS.alertsSnoozedUntil,
        Date.now() - 1,
      ] as const);
      await load(page);
      await expect(card(page)).toBeVisible();
      // Escape is Not now too.
      await page.keyboard.press('Escape');
      await expect(card(page)).not.toBeVisible();
      const until = await page.evaluate((key) => Number(localStorage.getItem(key)), STORAGE_KEYS.alertsSnoozedUntil);
      expect(until).toBeGreaterThan(Date.now() + ALERTS_SNOOZE_MS - 60_000);
    });

    test('No thanks hides the card for good, and the bell still works', async ({ page }) => {
      await fakePush(page);
      await returning(page);
      await load(page);
      await card(page).getByRole('button', { name: m.card.noThanks }).click();
      await expect(card(page)).not.toBeVisible();

      await load(page);
      await expect(card(page)).not.toBeVisible();
      await bell(page).click();
      await expect(card(page)).toBeVisible();
      await expect(card(page).getByRole('button', { name: m.card.turnOn })).toBeVisible();
    });

    test('turning off from the bell unsubscribes', async ({ page }) => {
      await fakePush(page, { subscribed: true });
      const calls = await recordSubscriptionCalls(page);
      // A subscriber's browser has the worker from an earlier visit; this first load registers it.
      await page.goto(localePath(locale));
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await load(page);
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(bell(page)).toHaveAttribute('title', m.bell.on);
      await bell(page).click();
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(bell(page)).toHaveAttribute('title', m.bell.off);
      await expect(page.getByText(m.card.turnedOff)).toBeVisible();
      expect(calls).toEqual([{ method: 'DELETE', body: { endpoint: ENDPOINT } }]);
    });

    test('blocked permission shows help', async ({ page }) => {
      await fakePush(page, { permission: 'denied' });
      await load(page);
      await expect(bell(page)).toHaveAttribute('title', m.bell.blocked);
      await bell(page).click();
      await expect(card(page)).toContainText(m.card.blockedHelp);
      await expect(card(page).getByRole('button', { name: m.card.turnOn })).toHaveCount(0);
      await card(page).getByRole('button', { name: m.card.close }).click();
      await expect(card(page)).not.toBeVisible();
    });

    test('a permission revoked in the browser settings shows as blocked', async ({ page }) => {
      await fakePush(page, { subscribed: true, permission: 'denied' });
      await load(page);
      await expect(bell(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(bell(page)).toHaveAttribute('title', m.bell.blocked);
    });

    test.describe('on an iPhone', () => {
      test.use({ userAgent: IPHONE_UA });

      test('Safari shows install steps', async ({ page }) => {
        await page.addInitScript(() => {
          // Safari outside a home-screen app has no push manager at all.
          delete (window as { PushManager?: unknown }).PushManager;
        });
        await returning(page);
        await load(page);
        await expect(card(page)).toBeVisible();
        await expect(card(page).getByRole('listitem')).toHaveText(m.card.iosSteps);
        await expect(card(page).getByRole('button', { name: m.card.turnOn })).toHaveCount(0);
        await card(page).getByRole('button', { name: m.card.notNow }).click();
        await expect(card(page)).not.toBeVisible();
        await expect(bell(page)).toHaveAttribute('title', m.bell.install);
        await bell(page).click();
        await expect(card(page).getByRole('listitem')).toHaveText(m.card.iosSteps);
      });
    });

    test('the open card fits a 320px screen', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await fakePush(page);
      await returning(page);
      await load(page);
      await expect(card(page)).toBeVisible();
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
      // Measured where it settles, after the entrance.
      await card(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const box = await card(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
    });
  });
}

test('admin registers no service worker and has no bell', async ({ page }) => {
  await page.goto(ADMIN_PAGE_PATH);
  await expect(page.getByLabel(admin.password)).toBeVisible();
  await expect(page.getByRole('button', { name: DICTIONARIES.en.alerts.bell.label })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
});
