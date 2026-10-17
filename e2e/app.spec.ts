import { test as base, type Cookie, expect, type Page } from '@playwright/test';
import { DAY_MS } from '../shared/api';
import { type Locale, site } from '../site.config';
import { activeBanners, BANNERS, type Banner } from '../src/banners';
import { zoned } from '../src/lib/zone';

const DEFAULT_LOCALE = site.locales[0];
const BRAND = site.brand.short;
/** The tab title during an outage: "OFF 5m · <brand>". */
const outageTitle = (state: string) => new RegExp(`^${state} \\d+m · ${BRAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Stores the app's language before every load of `page` (the app's own default is site.locales[0]). */
const withLocale = (page: Page, locale: Locale) => page.addInitScript((l) => localStorage.setItem('locale', l), locale);

// Most tests read the English copy; a block opts into Afrikaans with test.use({ appLocale: 'af' }).
// Pages from browser.newContext() don't get it: pass them to withLocale.
const test = base.extend<{ appLocale: Locale }>({
  appLocale: ['en', { option: true }],
  page: async ({ page, appLocale }, use) => {
    await withLocale(page, appLocale);
    await use(page);
  },
});

type ShiftWindow = Window & { __readCls: () => number };

/** Sums the page's layout shifts from the start of its load; call it before `goto`. */
const trackLayoutShift = (page: Page) =>
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
async function readLayoutShift(page: Page): Promise<number> {
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('.gg-trends-details table')).toBeAttached(); // the skeleton has no table
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (window as unknown as ShiftWindow).__readCls();
  });
}

// Tests share one local database and run in order.
test.describe.configure({ mode: 'serial' });

const ADMIN_USERNAME = 'admin'; // matches .dev.vars.example
const ADMIN_PASSWORD = 'test-password';

// Public copy never says how an outage was recorded, in either language.
const RECORDING_METHOD = /by hand|sensor|met die hand|handmatig|voeler/i;

// Log in through the UI once and reuse the cookie: the login endpoint allows 5 attempts a minute.
let sessionCookies: Cookie[] = [];

async function login(page: Page) {
  if (sessionCookies.length) await page.context().addCookies(sessionCookies);
  await page.goto('/admin');
  const dashboard = page.getByRole('heading', { name: 'Punch clock' });
  const password = page.getByLabel('Password');
  await expect(dashboard.or(password)).toBeVisible();
  if (await dashboard.isVisible()) return; // session cookie still valid
  await page.getByLabel('Username').fill(ADMIN_USERNAME);
  await password.fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(dashboard).toBeVisible();
  sessionCookies = (await page.context().cookies()).filter((c) => c.name === '__Host-admin_session');
}

test.describe('theme boot', () => {
  test('follows the system theme before the app loads', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.route('**/assets/*.js', (route) => route.abort()); // prove it is the inline boot script
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await context.close();
  });

  test('a saved preference beats the system theme and the toggle persists it', async ({ browser, appLocale }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await withLocale(page, appLocale);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('theme', 'light');
        sessionStorage.setItem('seeded', '1');
      }
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    await context.close();
  });
});

test.describe('language', () => {
  test('is Afrikaans by default', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
    await expect(page.getByRole('status')).toContainText('Die krag is aan');
    await expect(page.getByRole('heading', { name: 'Statistiek' })).toBeVisible();
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0);
    await expect(page).toHaveTitle(`AAN · ${BRAND}`);
    await context.close();
  });

  test('switches to English at once and remembers it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Die krag is aan');
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));

    await page.getByRole('button', { name: 'Switch to English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('Power is on');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skakel oor na Afrikaans' })).toHaveAttribute('lang', 'af');
    expect(await page.evaluate(() => '__sameDocument' in window)).toBe(true); // no reload

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('Power is on');
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('en');
    await context.close();
  });

  test('shows the loading shell in the stored language before the app loads', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/assets/*.js', (route) => route.abort()); // only the static shell and boot script
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
    await expect(page.getByRole('heading', { name: 'Statistiek' })).toBeVisible();

    await withLocale(page, 'en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent outages' })).toBeVisible();
    await expect(page.getByText('Independent service.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skakel oor na Afrikaans' })).toHaveText('AF');
    await context.close();
  });
});

test.describe('public page', () => {
  test('shows power on by default without a sensor', async ({ page }) => {
    await page.goto('/');
    const status = page.getByRole('status');
    await expect(status).toContainText('Power is on');
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0); // never says how outages are recorded
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  for (const locale of site.locales) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      test(`has zero cumulative layout shift while loading (${locale})`, async ({ page }) => {
        await trackLayoutShift(page);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        expect(await readLayoutShift(page)).toBe(0);
      });
    });
  }

  test('loads without CSP violations or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('status')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('says so when the server fails on first load', async ({ page }) => {
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText('Unable to reach the server. Retrying shortly.');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  test('keeps the last status and warns when a later poll fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Power is on');
    await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // polls now
    await expect(page.getByRole('alert')).toHaveText(
      /^Unable to reach the server\. Showing the status as at \d\d:\d\d\.$/,
    );
    await expect(page.getByRole('status')).toContainText('Power is on');
  });

  test('serves the SEO manifests', async ({ request }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api/admin/');
    expect(await (await request.get('/sitemap.xml')).text()).toContain('/privacy</loc>');
    const og = await request.get('/og.png');
    expect(og.headers()['content-type']).toBe('image/png');
  });
});

test.describe('admin', () => {
  test('is kept out of search results', async ({ request }) => {
    expect((await request.get('/admin')).headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Username').fill(ADMIN_USERNAME);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
  });

  test('sets an HttpOnly, Strict session cookie', async ({ page, context }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name === '__Host-admin_session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  });

  test('punch clock drives the public status', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Punch out' }).click();
    await expect(page.getByTestId('punch-clock')).not.toHaveText('00:00:00');

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Power is off');
    await expect(page).toHaveTitle(outageTitle('OFF'));
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-off.svg');
    await page.getByRole('button', { name: 'Skakel oor na Afrikaans' }).click();
    await expect(page.getByRole('status')).toContainText('Die krag is af');
    await expect(page).toHaveTitle(outageTitle('AF'));
    await page.getByRole('button', { name: 'Switch to English' }).click();

    await login(page);
    await page.getByRole('button', { name: 'Punch in' }).click();
    await expect(page.getByTestId('punch-clock')).toHaveText('00:00:00');
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Power is on');
    await expect(page).toHaveTitle(`ON · ${BRAND}`);
  });

  test('logs a past outage', async ({ page }) => {
    await login(page);
    await page.getByLabel('Started').fill('2026-10-01T18:00');
    await page.getByLabel('Ended').fill('2026-10-01T20:30');
    await page.getByRole('button', { name: 'Log outage' }).click();
    await expect(page.getByText('2 h 30 min · manual')).toBeVisible();
  });
});

test.describe('community confirmation', () => {
  test('confirms once, then rate limits', async ({ page, request }) => {
    await login(page);
    await page.getByRole('button', { name: 'Punch out' }).click();
    await expect(page.getByRole('button', { name: 'Punch in' })).toBeEnabled();
    try {
      await page.goto('/');
      // Cloudflare's test site key passes Turnstile without a challenge.
      await page.getByTestId('confirm-outage').click();
      await expect(page.getByTestId('confirm-outage')).toHaveText('Confirmation recorded', { timeout: 20_000 });
      await expect(page.getByText('1 community confirmation.')).toBeVisible();

      // Same client again: one confirmation per outage, then 5 requests a minute. The limiter counts in
      // fixed one-minute windows, so a window boundary can reset the count: post until the first 429.
      const codes: number[] = [];
      while (codes.length < 12 && !codes.includes(429)) {
        codes.push((await request.post('/api/confirm', { data: { token: 'XXXX.DUMMY.TOKEN' } })).status());
      }
      expect(codes).toContain(429);
      expect(codes.slice(0, -1).every((code) => code === 409)).toBe(true);
    } finally {
      // Close the outage this test opened, so a retry starts from a clean state.
      await page.request.post('/api/admin/timer', { data: { action: 'punch_in' } });
    }
  });
});

test.describe('admin session', () => {
  test('sign out ends the session', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});

test.describe('site banner', () => {
  const VOTE = 'vote-2026-11-04';
  const VOTE_UNTIL = zoned('2026-11-05T00:00');
  const DURING = new Date(zoned('2026-10-28T09:00'));
  const notice = (page: Page) => page.getByRole('region', { name: 'Notice' });

  test('picks the banners active at a given time', () => {
    const at = (iso: string) => activeBanners(Date.parse(iso)).map((b) => b.id);
    expect(at(zoned('2026-10-16T23:59:59'))).toEqual([]);
    expect(at(zoned('2026-10-17T00:00:00'))).toEqual([VOTE]);
    expect(at(zoned('2026-11-04T23:59:59'))).toEqual([VOTE]);
    expect(at(VOTE_UNTIL)).toEqual([]); // `until` is exclusive
    const later: Banner = {
      id: 'later',
      from: zoned('2026-11-01T00:00'),
      until: VOTE_UNTIL,
      text: { af: '', en: '' },
    };
    expect(activeBanners(DURING.getTime() + 7 * DAY_MS, [...BANNERS, later]).map((b) => b.id)).toEqual([VOTE, 'later']);
  });

  test('shows the election notice before its end date, in English', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await page.goto('/');
    await expect(notice(page)).toContainText('Local government elections take place on Wednesday 4 November 2026.');
    const link = notice(page).getByRole('link', { name: 'Voter information from the IEC' });
    await expect(link).toHaveAttribute('href', 'https://www.elections.org.za/pw/Voter/Voter-Information');
    await expect(link).not.toHaveAttribute('target', /.*/);
    await expect(notice(page).getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });

  test.describe('in Afrikaans', () => {
    test.use({ appLocale: 'af' });

    test('is in Afrikaans by default', async ({ page }) => {
      await page.clock.setFixedTime(DURING);
      await page.goto('/');
      const region = page.getByRole('region', { name: 'Kennisgewing' });
      await expect(region).toContainText('Die plaaslike regeringsverkiesing vind op Woensdag 4 November 2026 plaas.');
      await expect(region.getByRole('link', { name: 'Kiesersinligting by die OVK' })).toBeVisible();
      await expect(region.getByRole('button', { name: 'Maak toe' })).toBeVisible();
    });
  });

  test('is gone once its end date passes', async ({ page }) => {
    await page.clock.setFixedTime(VOTE_UNTIL);
    await page.goto('/');
    await expect(page.getByRole('status')).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test('hides at its end date without a reload', async ({ page }) => {
    await page.clock.install({ time: Date.parse(VOTE_UNTIL) - 30_000 });
    await page.goto('/');
    await expect(notice(page)).toBeVisible();
    await page.clock.fastForward('02:00');
    await expect(notice(page)).toHaveCount(0);
  });

  test('stays dismissed across a reload', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await page.goto('/');
    await notice(page).getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Enter');
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused(); // focus lands on the content, not <body>
    await page.reload();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate((id) => localStorage.getItem(`banner-dismissed:${id}`), VOTE)).toBe('1');
  });

  test('causes no layout shift and never covers the footer', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(notice(page)).toBeVisible();
    expect(await readLayoutShift(page)).toBe(0);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = await page.locator('.gg-footer').boundingBox();
    const banner = await notice(page).boundingBox();
    expect(footer && banner && banner.y >= footer.y + footer.height).toBe(true);
  });
});
