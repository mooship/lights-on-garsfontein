import { readFileSync } from 'node:fs';
import { test as base, type Cookie, expect, type Page } from '@playwright/test';
import { DAY_MS } from '../shared/api';
import { localePath } from '../shared/locale';
import { type Locale, site } from '../site.config';
import { activeBanners, BANNERS, type Banner } from '../src/banners';
import { en } from '../src/i18n/en';
import { zoned } from '../src/lib/zone';
import { cacheName, STATUS_CACHE } from '../src/sw/strategy';

const DEFAULT_LOCALE = site.locales[0];
const BRAND = site.brand.short;
/** The tab title without a live reading: it claims no status. */
const NEUTRAL_TITLE = site.brand.full;
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
    await expect(page.getByRole('status')).toContainText('Geen onderbreking aangemeld nie');
    await expect(page.getByRole('heading', { name: 'Statistiek' })).toBeVisible();
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
    await context.close();
  });

  test('switches to English at once, moves to /en/ and remembers it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Geen onderbreking aangemeld nie');
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
    await expect(page.getByRole('button', { name: 'Switch to English' })).toHaveText('English');

    await page.getByRole('button', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skakel oor na Afrikaans' })).toHaveAttribute('lang', 'af');
    await expect(page.getByRole('button', { name: 'Skakel oor na Afrikaans' })).toHaveText('Afrikaans');
    expect(await page.evaluate(() => '__sameDocument' in window)).toBe(true); // no reload

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('en');

    await page.getByRole('button', { name: 'Skakel oor na Afrikaans' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status')).toContainText('Geen onderbreking aangemeld nie');
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('af');

    // Back returns to the English URL, and the language follows it.
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await context.close();
  });

  test('opens / at /en/ for a visitor who chose English, before the app renders', async ({ page }) => {
    const statusFetchedFrom: string[] = [];
    page.on('request', (r) => r.url().endsWith('/api/status') && statusFetchedFrom.push(r.frame().url()));
    await page.goto('/?from=share');
    await expect(page).toHaveURL(/\/en\/\?from=share$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    // Only /en/ asked for the status: the Afrikaans page never started the app.
    expect(statusFetchedFrom.map((url) => new URL(url).pathname)).toEqual(['/en/']);
  });

  test.describe('with Afrikaans stored', () => {
    test.use({ appLocale: 'af' });

    test('/en/ is in English and becomes the stored choice', async ({ page }) => {
      await page.goto('/en/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('status')).toContainText('No outage reported');
      expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('en');
    });
  });

  test('/en redirects to /en/', async ({ request }) => {
    const res = await request.get('/en', { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(res.status());
    expect(res.headers().location).toBe('/en/');
  });

  const HEADS: Record<Locale, { title: string; description: RegExp; ogDescription: RegExp; statistics: string }> = {
    af: {
      title: `Is die krag af in Garsfontein? · ${site.brand.full}`,
      description: /^Is die krag af in Garsfontein, Pretoria\? Kragstatus/,
      ogDescription: /^Kragstatus soos laas gemeet/,
      statistics: 'Statistiek',
    },
    en: {
      title: `Is the power off in Garsfontein? · ${site.brand.full}`,
      description: /^Is the power off in Garsfontein, Pretoria\? Power outage status/,
      ogDescription: /^Power status as last measured/,
      statistics: 'Statistics',
    },
  };

  for (const locale of site.locales) {
    const path = localePath(locale);

    test(`${path} is the ${locale} page before any script runs`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(path);
      const head = HEADS[locale];
      const meta = (selector: string) => page.locator(`meta[${selector}]`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page).toHaveTitle(head.title);
      await expect(meta('name="description"')).toHaveAttribute('content', head.description);
      await expect(meta('property="og:title"')).toHaveAttribute('content', head.title);
      await expect(meta('property="og:description"')).toHaveAttribute('content', head.ogDescription);
      await expect(meta('property="og:url"')).toHaveAttribute('content', `${site.url}${path}`);
      await expect(meta('property="og:locale"')).toHaveAttribute('content', site.intlLocales[locale].replace('-', '_'));
      await expect(meta('property="og:locale:alternate"')).toHaveCount(site.locales.length - 1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${site.url}${path}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) => links.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')]));
      expect(alternates).toEqual([
        ...site.locales.map((l) => [l, `${site.url}${localePath(l)}`]),
        ['x-default', `${site.url}/`],
      ]);
      // The shell carries every language; the page's lang alone picks which one shows.
      await expect(page.getByRole('heading', { name: head.statistics })).toBeVisible();
      await context.close();
    });
  }

  test('shows the loading shell in the stored language before the app loads', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/assets/*.js', (route) => route.abort()); // only the static shell and boot script
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
    await expect(page.getByRole('heading', { name: 'Statistiek' })).toBeVisible();

    await withLocale(page, 'en');
    await page.reload();
    await expect(page).toHaveURL(/\/en\/$/); // the boot script redirects without the app
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent outages' })).toBeVisible();
    await expect(page.getByText('Independent service.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skakel oor na Afrikaans' })).toHaveText('Afrikaans');
    await expect(page.getByText('Measured in Garsfontein Ext. 16', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Still off where you are?' })).toBeDisabled();
    await context.close();
  });
});

test.describe('public page', () => {
  test('without a live reading, says only that no outage is reported', async ({ page }) => {
    await page.goto('/');
    const status = page.getByRole('status');
    await expect(status).toHaveText('No outage reported');
    await expect(page.getByText('Not measured live.')).toBeVisible();
    await expect(page.getByText(/^for \d/)).toHaveCount(0); // no "for 7 h": nothing measured it on
    await expect(page.locator('[data-status="NONE"]')).toBeVisible();
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0); // never says how outages are recorded
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  test('with a live reading, says the power is on and for how long', async ({ page }) => {
    await page.route('**/api/status', async (route) => {
      const response = await route.fetch();
      const since = new Date(Date.now() - 150 * 60_000).toISOString();
      await route.fulfill({ response, json: { ...(await response.json()), monitored: true, since } });
    });
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText('The power is on');
    await expect(page.getByText(/^for 2 h \d+ min$/)).toBeVisible();
    await expect(page).toHaveTitle(`ON · ${BRAND}`);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-on.svg');
  });

  test('leads with the ward, names the full brand and says what the measurement covers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.brand.full);
    await expect(page.locator('.gg-eyebrow')).toHaveText('Ward 45 · Pretoria');
    const scope = site.landmark
      ? `Measured in Garsfontein Ext. 16, near ${site.landmark}. Some streets may differ.`
      : 'Measured in Garsfontein Ext. 16. Some streets may differ.';
    await expect(page.getByText(scope)).toBeVisible();
    await page.getByText('Why?', { exact: true }).click();
    await expect(page.getByText('usually goes off as a whole', { exact: false })).toBeVisible();
  });

  test('links fault reports to the configured page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Always treat power lines as live.', { exact: false })).toBeVisible();
    const link = page.getByRole('link', { name: en.safety.report });
    await expect(link).toHaveAttribute('href', site.faultReporting.url);
  });

  test('statistics show durations and say how they are measured', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.gg-trends-body')).toContainText('0 min');
    await expect(page.getByText('No outages to chart yet.')).toBeVisible();
    await expect(page.getByText(/compared with the previous 30 days/)).toHaveCount(0);
    await page.getByText('How we measure').click();
    await expect(page.getByText('Planned outages are included.')).toBeVisible();
  });

  test('the footer links the data licence and the feed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: site.dataLicence.name })).toHaveAttribute('href', site.dataLicence.url);
    await expect(page.getByRole('link', { name: 'Atom feed' })).toHaveAttribute('href', '/feed.xml');
    await expect(page.getByRole('link', { name: 'Privacy and terms' })).toHaveAttribute('href', '/privacy');
  });

  for (const locale of site.locales) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      test(`has zero cumulative layout shift while loading (${locale})`, async ({ page }) => {
        await trackLayoutShift(page);
        await page.goto(localePath(locale));
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
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // polls now
    await expect(page.getByRole('alert')).toHaveText(
      /^Unable to reach the server\. Showing the status as at \d\d:\d\d\.$/,
    );
    await expect(page.getByRole('status')).toContainText('No outage reported');
  });

  test('serves the SEO manifests', async ({ request }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api/admin/');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    // The origin is the Worker's SITE_URL, which is local here.
    const locs = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(['/', '/en/', '/privacy']);
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
    await expect(page.getByRole('button', { name: 'Punch in' })).toHaveCount(0); // only the action that applies
    await page.getByRole('button', { name: 'Punch out' }).click();
    await expect(page.getByTestId('punch-clock')).not.toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: /^Punched out at \d\d:\d\d$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Punch out' })).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('The power is off');
    await expect(page.getByText('Is your power off too? One tap, anonymous.', { exact: false })).toBeVisible();
    await expect(page.getByText('Be the first to confirm.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Still off where you are?' })).toHaveCount(0);
    await expect(page).toHaveTitle(outageTitle('OFF'));
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-off.svg');
    await page.getByRole('button', { name: 'Skakel oor na Afrikaans' }).click();
    await expect(page.getByRole('status')).toContainText('Die krag is af');
    await expect(page).toHaveTitle(outageTitle('AF'));
    await page.getByRole('button', { name: 'Switch to English' }).click();

    await login(page);
    await page.getByRole('button', { name: 'Punch in' }).click();
    await expect(page.getByTestId('punch-clock')).toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: /^Punched in at \d\d:\d\d$/ })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
  });

  test('logs a past outage', async ({ page }) => {
    await login(page);
    await page.getByLabel('Started').fill('2026-10-01T18:00');
    await page.getByLabel('Ended').fill('2026-10-01T20:30');
    await page.getByRole('button', { name: 'Log outage' }).click();
    await expect(page.getByText('2 h 30 min · manual')).toBeVisible();
  });
});

test.describe('still off where you are', () => {
  test('reports once, shows the count and remembers the report', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByText('This does not change the status or notify the City.')).toBeVisible();
    // Cloudflare's test site key passes Turnstile without a challenge.
    await page.getByRole('button', { name: 'Still off where you are?' }).click();
    await expect(page.getByText('Thanks, noted.')).toBeVisible({ timeout: 20_000 });
    const count = page.getByText('1 resident reported their power still off in the last hour.', { exact: false });
    await expect(count).toBeVisible();
    await expect(page.getByTestId('still-off')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('status')).toHaveText('No outage reported'); // the status does not change

    // The count now comes from the status, and this browser remembers it reported.
    await page.reload();
    await expect(count).toBeVisible();
    await expect(page.getByTestId('still-off')).toHaveAttribute('aria-disabled', 'true');

    // The server allows one report per client per two hours.
    const again = await request.post('/api/still-off', { data: { token: 'XXXX.DUMMY.TOKEN' } });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'already_reported' });
  });

  test.describe('in Afrikaans', () => {
    test.use({ appLocale: 'af' });

    test('shows the error when the server says it was already reported', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Steeds af by jou?' }).click();
      await expect(page.getByText('Jy het die afgelope twee uur reeds aangemeld.')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('1 inwoner het die afgelope uur gesê', { exact: false })).toBeVisible();
    });
  });
});

test.describe('share', () => {
  // The page being shared: English readers are on /en/.
  const SHARE_URL = `${site.url}/en/`;
  const TEXT = 'Is the power off in Garsfontein? Check here:';

  test('links WhatsApp and Telegram with the text and link encoded, in a new tab', async ({ page }) => {
    await page.goto('/');
    const whatsapp = page.getByRole('link', { name: 'Share on WhatsApp (opens in a new tab)' });
    await expect(whatsapp).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(`${TEXT} ${SHARE_URL}`)}`);
    const telegram = page.getByRole('link', { name: 'Share on Telegram (opens in a new tab)' });
    await expect(telegram).toHaveAttribute(
      'href',
      `https://t.me/share/url?url=${encodeURIComponent(SHARE_URL)}&text=${encodeURIComponent(TEXT)}`,
    );
    for (const link of [whatsapp, telegram]) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('uses the share sheet where there is one', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data: ShareData) => Object.assign(window, { __shared: data }),
      });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Share with neighbours' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shared?: ShareData }).__shared))
      .toEqual({ title: site.brand.full, text: TEXT, url: SHARE_URL });
  });

  test('copies the link where there is no share sheet', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      delete (Navigator.prototype as Partial<Navigator>).share;
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Share with neighbours' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SHARE_URL);
  });
});

test.describe('privacy contact', () => {
  // Before the confirmation test: /api/contact shares CONFIRM_LIMITER, which that test spends.
  test('reveals the contact email after Turnstile', async ({ page }) => {
    // playwright.config.ts passes the .dev.vars.example placeholder to wrangler dev.
    const { readFileSync } = await import('node:fs');
    const email = /^CONTACT_EMAIL="([^"\s]+)"/m.exec(readFileSync('.dev.vars.example', 'utf8'))?.[1];
    if (!email) throw new Error('.dev.vars.example has no CONTACT_EMAIL');
    await page.goto('/privacy');
    const en = page.locator('#en');
    await en.getByRole('button', { name: 'Show email address' }).click();
    const mail = en.getByRole('link', { name: email });
    await expect(mail).toHaveAttribute('href', `mailto:${email}`);
    await expect(mail).toBeFocused();
    await expect(en.getByRole('button', { name: 'Show email address' })).toHaveCount(0);
    await expect(en.getByRole('link', { name: 'open an issue on GitHub' })).toBeVisible();
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

      // Same client again: one confirmation per outage, then CONFIRM_LIMITER's 10 requests a minute
      // (the e2e environment in wrangler.toml). The limiter counts in fixed one-minute windows, so a
      // window boundary can reset the count: post until the first 429.
      const codes: number[] = [];
      while (codes.length < 25 && !codes.includes(429)) {
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

  test('sits in the page flow after the cards, causing no layout shift and covering nothing', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(notice(page)).toBeVisible();
    expect(await readLayoutShift(page)).toBe(0);

    expect(await notice(page).evaluate((el) => getComputedStyle(el).position)).toBe('static');
    // The last thing in <main>, between the last card and the footer.
    expect(await notice(page).evaluate((el) => el.parentElement?.lastElementChild === el)).toBe(true);
    const card = await page.locator('.gg-main > .gg-card').last().boundingBox();
    const banner = await notice(page).boundingBox();
    const footer = await page.locator('.gg-footer').boundingBox();
    expect(card && banner && banner.y >= card.y + card.height).toBe(true);
    expect(banner && footer && footer.y >= banner.y + banner.height).toBe(true);
  });
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const locale of site.locales) {
    for (const path of ['/', '/en/', '/privacy', '/admin']) {
      test(`${path} has no horizontal scroll at 320px (${locale})`, async ({ page }) => {
        await withLocale(page, locale);
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll).toBeLessThanOrEqual(client);
      });
    }
  }
});

test.describe('offline', () => {
  // Every other test blocks service workers (playwright.config.ts).
  test.use({ serviceWorkers: 'allow', appLocale: 'af' });

  /** Opens `path` through the service worker, with the status it fetched stored for offline use. */
  async function throughServiceWorker(page: Page, path: string) {
    await page.goto(path);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // the first load came before the worker; this one goes through it
    await expect(page.getByRole('status')).toBeVisible();
    await expect.poll(() => cachedGeneratedAt(page)).not.toBeNull();
  }

  /** When the server produced the worker's copy of the status, or null without one. */
  const cachedGeneratedAt = (page: Page) =>
    page.evaluate(async () => {
      const copy = await caches.match('/api/status');
      return copy ? ((await copy.json()) as { generatedAt: string }).generatedAt : null;
    });

  /** Makes the page poll the status now. */
  const poll = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  const cachedPaths = (page: Page) =>
    page.evaluate(async () => {
      const paths: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    });

  test('registers the worker only after the page has loaded', async ({ page }) => {
    const order: string[] = [];
    page.on('load', () => order.push('load'));
    page.context().on('serviceworker', () => order.push('worker'));
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    expect(order).toEqual(['load', 'worker']);
  });

  test('shows / and /en/ from the cache, labelled with the age of the status, until the network is back', async ({
    page,
    context,
  }) => {
    await throughServiceWorker(page, '/');
    await expect(page.getByText(/^Bygewerk om \d\d:\d\d$/)).toBeVisible();
    // This build's shell, named after the build id in sw.js, and the status copy beside it.
    const keys = (await page.evaluate(() => caches.keys())).sort();
    expect(keys).toEqual([STATUS_CACHE, expect.stringMatching(`^${cacheName('')}`)].sort());
    const buildId = keys.find((key) => key !== STATUS_CACHE)?.slice(cacheName('').length);
    expect(readFileSync('dist/sw.js', 'utf8')).toContain(`\`${buildId}\``);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'af');
    await expect(page.getByRole('status')).toContainText('Geen onderbreking aangemeld nie');
    await expect(page.getByRole('alert')).toHaveText(/^Geen verbinding · status soos om \d\d:\d\d$/);
    await expect(page.getByText(/^Bygewerk om/)).toHaveCount(0); // never presented as current

    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await expect(page.getByRole('alert')).toHaveText(/^No connection · status as at \d\d:\d\d$/);

    // A copy from another day says which day.
    await page.evaluate(async (status) => {
      const copy = (await caches.match('/api/status')) as Response;
      const body = { ...(await copy.json()), generatedAt: new Date(Date.now() - 86_400_000).toISOString() };
      await (await caches.open(status)).put('/api/status', new Response(JSON.stringify(body), copy));
    }, STATUS_CACHE);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText(/^No connection · status as at \d\d:\d\d yesterday$/);

    await context.setOffline(false);
    await poll(page);
    await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('labels the copy while the network is slow or failing, and keeps a late reply', async ({ page, context }) => {
    await throughServiceWorker(page, '/en/');
    // context.route sees the worker's own requests, so this slows the network under it. The late
    // reply is stamped, because the Worker's edge cache would repeat the last generatedAt.
    const stamp = new Date(Date.now() - 60_000).toISOString();
    await context.route('**/api/status', async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.fulfill({ response, json: { ...(await response.json()), generatedAt: stamp } });
    });
    await poll(page);
    await expect(page.getByRole('alert')).toHaveText(/^No connection · status as at \d\d:\d\d$/, { timeout: 4_500 });
    await expect.poll(() => cachedGeneratedAt(page), { timeout: 10_000 }).toBe(stamp); // kept for next time

    await context.unroute('**/api/status');
    await context.route('**/api/status', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
    await poll(page);
    await expect(page.getByRole('alert')).toHaveText(/^No connection · status as at \d\d:\d\d$/);

    await context.unroute('**/api/status');
    await poll(page);
    await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('never stores pages at runtime: offline is always this build’s own copy', async ({ page, context }) => {
    await throughServiceWorker(page, '/en/');
    // Another deploy's page, as a navigation might fetch mid-deploy. Without navigation preload,
    // which context.route cannot see, the worker's own fetch brings it.
    await page.evaluate(async () => (await navigator.serviceWorker.ready).navigationPreload.disable());
    const enPage = (url: URL) => url.pathname === '/en/';
    await context.route(enPage, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('</head>', '<meta name="e2e-build" content="next" /></head>');
      await route.fulfill({ response, body });
    });
    await page.reload();
    await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(1);

    await context.unroute(enPage);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('status')).toContainText('No outage reported');
    await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(0);
  });

  test('keeps /admin, writes and the rest of the API out of the cache', async ({ page, context }) => {
    await throughServiceWorker(page, '/');
    await page.goto('/admin');
    await expect(page.getByRole('button', { name: /Teken in|Sign in/ })).toBeVisible();
    await page.goto('/privacy');
    await page.goto('/');
    await expect(page.getByRole('status')).toBeVisible();

    const paths = await cachedPaths(page);
    expect(paths).toEqual(expect.arrayContaining(['/', '/en/', '/privacy', '/api/status']));
    const shell = new Set(['/', '/en/', '/privacy', '/api/status']);
    expect(paths.filter((path) => !shell.has(path) && !path.startsWith('/assets/'))).toEqual([]);

    // Writes and the admin API pass straight through; the status is answered by the worker.
    const fetched = async (path: string, init?: { method: string }) => {
      const [response] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === path),
        page.evaluate(([p, i]) => fetch(p, i).then((r) => r.status), [path, init] as const),
      ]);
      return response.fromServiceWorker();
    };
    expect(await fetched('/api/admin/logout', { method: 'POST' })).toBe(false);
    expect(await fetched('/api/admin/outages')).toBe(false);
    expect(await fetched('/api/status')).toBe(true);

    await context.setOffline(true);
    await expect(page.goto('/admin')).rejects.toThrow();
  });

  test('a load through the worker has zero layout shift', async ({ page }) => {
    await throughServiceWorker(page, '/en/');
    await trackLayoutShift(page);
    await page.reload();
    expect(await readLayoutShift(page)).toBe(0);
  });
});
