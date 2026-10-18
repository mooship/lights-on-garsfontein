import type { Cookie, Locator, Page } from '@playwright/test';
import { fill } from '../build/html';
import { DAY_MS, MINUTE_MS, type StatsResponse } from '../shared/api';
import { ERROR } from '../shared/errors';
import { DEFAULT_LOCALE, LOCALES, localePath } from '../shared/locale';
import {
  ADMIN_API_PREFIX,
  ADMIN_OUTAGES_PATH,
  ADMIN_PAGE_PATH,
  FEED_PATH,
  OG_IMAGE_PATH,
  PRIVACY_PAGE_PATH,
  ROBOTS_PATH,
  SITEMAP_PATH,
  STATS_PATH,
  STATUS_PATH,
} from '../shared/paths';
import { type Locale, site } from '../site.config';
import { admin } from '../src/admin/copy';
import { BANNERS } from '../src/banners';
import { DICTIONARIES } from '../src/i18n';
import { af } from '../src/i18n/af';
import { en } from '../src/i18n/en';
import { HEAD } from '../src/i18n/head';
import { bannerDismissedKey, STORAGE_KEYS } from '../src/lib/storage';
import { SESSION_COOKIE } from '../worker/lib/cookies';
import { exampleVar } from './dev-vars';
import { expect, readLayoutShift, test, trackLayoutShift, withLocale } from './fixtures';

// Copy comes from the dictionaries, so a wording change does not break a test about behaviour.
// One literal per language ('Geen onderbreking aangemeld nie', 'No outage reported') checks the
// dictionaries reach the page at all.

const BRAND = site.brand.short;
/** The tab title without a live reading: it claims no status. */
const NEUTRAL_TITLE = site.brand.full;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Stands for a clock time in a message, for `withTime`. */
const AT = '@@:@@';
/** Matches exactly `text`, with each AT any HH:MM. */
const withTime = (text: string) => new RegExp(`^${escapeRegExp(text).replaceAll(AT, '\\d\\d:\\d\\d')}$`);
/** The tab title during an outage: "OFF 5m · <brand>". */
const outageTitle = (state: string) => new RegExp(`^${state} \\d+${en.units.m} · ${escapeRegExp(BRAND)}$`);

const ADMIN_USERNAME = exampleVar('ADMIN_USERNAME');
const ADMIN_PASSWORD = 'test-password';

// Public copy never says how an outage was recorded, in either language.
const RECORDING_METHOD = /by hand|sensor|met die hand|handmatig|voeler/i;

// Log in through the UI once and reuse the cookie: LOGIN_LIMITER (wrangler.toml) allows only a few a minute.
let sessionCookies: Cookie[] = [];

async function login(page: Page) {
  if (sessionCookies.length) await page.context().addCookies(sessionCookies);
  await page.goto(ADMIN_PAGE_PATH);
  const dashboard = page.getByRole('heading', { name: admin.punchClock });
  const password = page.getByLabel(admin.password);
  await expect(dashboard.or(password)).toBeVisible();
  if (await dashboard.isVisible()) return; // session cookie still valid
  await page.getByLabel(admin.username).fill(ADMIN_USERNAME);
  await password.fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: admin.signIn }).click();
  await expect(dashboard).toBeVisible();
  sessionCookies = (await page.context().cookies()).filter((c) => c.name === SESSION_COOKIE);
}

/** Only `locale`'s copy of the static shell shows; the others are there, but hidden. */
async function expectShellIn(page: Page, locale: Locale) {
  const others = page.locator(`[data-l]:not([data-l="${locale}"])`);
  await expect(others).not.toHaveCount(0);
  await expect(page.locator(`[data-l]:not([data-l="${locale}"]):visible`)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: DICTIONARIES[locale].trends.title, exact: true })).toBeVisible();
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
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, 'light');
        sessionStorage.setItem('seeded', '1');
      }
    }, STORAGE_KEYS.theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);

    await page.getByRole('button', { name: en.theme.toDark }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.theme)).toBe('dark');
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
    await expect(page.getByRole('heading', { name: af.trends.title, exact: true })).toBeVisible();
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
    await context.close();
  });

  test('switches to English at once, moves to /en/ and remembers it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(af.status.NONE);
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
    await expect(page.getByRole('button', { name: af.lang.switchTo })).toHaveText(af.lang.next);

    await page.getByRole('button', { name: af.lang.switchTo }).click();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: en.lang.switchTo })).toHaveAttribute('lang', 'af');
    await expect(page.getByRole('button', { name: en.lang.switchTo })).toHaveText(en.lang.next);
    expect(await page.evaluate(() => '__sameDocument' in window)).toBe(true); // no reload

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.locale)).toBe('en');

    await page.getByRole('button', { name: en.lang.switchTo }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status')).toContainText(af.status.NONE);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.locale)).toBe('af');

    // Back returns to the English URL, and the language follows it.
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await context.close();
  });

  test('opens / at /en/ for a visitor who chose English, before the app renders', async ({ page }) => {
    const statusFetchedFrom: string[] = [];
    page.on('request', (r) => r.url().endsWith(STATUS_PATH) && statusFetchedFrom.push(r.frame().url()));
    await page.goto('/?from=share');
    await expect(page).toHaveURL(/\/en\/\?from=share$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    // Only /en/ asked for the status: the Afrikaans page never started the app.
    expect(statusFetchedFrom.map((url) => new URL(url).pathname)).toEqual(['/en/']);
  });

  test.describe('with Afrikaans stored', () => {
    test.use({ appLocale: 'af' });

    test('/en/ is in English and becomes the stored choice', async ({ page }) => {
      await page.goto('/en/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('status')).toContainText(en.status.NONE);
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.locale)).toBe('en');
    });

    test('/admin is in English, without a switch, and leaves the stored choice alone', async ({ page }) => {
      await page.goto(ADMIN_PAGE_PATH);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { name: admin.signInTitle })).toBeVisible();
      await expect(page.getByRole('button', { name: admin.signIn })).toBeVisible();
      await expect(page.getByRole('link', { name: en.footer.privacy })).toBeVisible();
      await expect(page.locator('.gg-lang-button')).toHaveCount(0);
      await login(page);
      await expect(page.getByRole('heading', { name: admin.punchClock })).toBeVisible();

      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'af');
      await expect(page.getByRole('status')).toContainText(af.status.NONE);
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.locale)).toBe('af');
    });

    test('/admin shows the English loading shell before the app loads', async ({ page }) => {
      await page.route('**/assets/*.js', (route) => route.abort()); // only the static shell and boot script
      await page.goto(ADMIN_PAGE_PATH);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expectShellIn(page, 'en');
    });
  });

  test('/en redirects to /en/', async ({ request }) => {
    const res = await request.get('/en', { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(res.status());
    expect(res.headers().location).toBe('/en/');
  });

  for (const locale of LOCALES) {
    const path = localePath(locale);

    test(`${path} is the ${locale} page before any script runs`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(path);
      const head = (key: keyof (typeof HEAD)[Locale]) => fill(HEAD[locale][key], 'text', 'src/i18n/head.ts');
      const meta = (selector: string) => page.locator(`meta[${selector}]`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page).toHaveTitle(head('title'));
      await expect(meta('name="description"')).toHaveAttribute('content', head('description'));
      await expect(meta('property="og:title"')).toHaveAttribute('content', head('title'));
      await expect(meta('property="og:description"')).toHaveAttribute('content', head('ogDescription'));
      await expect(meta('property="og:url"')).toHaveAttribute('content', `${site.url}${path}`);
      await expect(meta('property="og:locale"')).toHaveAttribute('content', site.intlLocales[locale].replace('-', '_'));
      await expect(meta('property="og:locale:alternate"')).toHaveCount(LOCALES.length - 1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${site.url}${path}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) => links.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')]));
      expect(alternates).toEqual([
        ...LOCALES.map((l) => [l, `${site.url}${localePath(l)}`]),
        ['x-default', `${site.url}/`],
      ]);
      // The shell carries every language; the page's lang alone picks which one shows.
      await expectShellIn(page, locale);
      await context.close();
    });
  }

  test('shows the loading shell in the stored language before the app loads', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/assets/*.js', (route) => route.abort()); // only the static shell and boot script
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE);
    await expectShellIn(page, DEFAULT_LOCALE);

    await withLocale(page, 'en');
    await page.reload();
    await expect(page).toHaveURL(/\/en\/$/); // the boot script redirects without the app
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expectShellIn(page, 'en');
    await expect(page.getByRole('heading', { name: en.history.title, exact: true })).toBeVisible();
    await expect(page.getByText(en.masthead.notice, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: en.lang.switchTo })).toHaveText(en.lang.next);
    await expect(page.getByText(en.scope.measured(site.landmark), { exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe('public page', () => {
  test('without a live reading, says only that no outage is reported', async ({ page }) => {
    await page.goto('/');
    const status = page.getByRole('status');
    await expect(status).toHaveText('No outage reported');
    // No "for 7 h": nothing measured it on.
    await expect(page.getByText(new RegExp(`^${escapeRegExp(en.status.for(''))}\\d`))).toHaveCount(0);
    await expect(page.locator('[data-status="NONE"]')).toBeVisible();
    // Just the one line of detail: no warning while all is well.
    await expect(page.locator('.gg-status-detail > p')).toHaveCount(1);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0); // never says how outages are recorded
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
  });

  for (const locale of LOCALES) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      // The detail line below already describes the last outage, so the badge adds nothing.
      test(`without a live reading, adds no line under the headline (${locale})`, async ({ page }) => {
        const m = DICTIONARIES[locale];
        await page.route(`**${STATUS_PATH}`, async (route) => {
          const response = await route.fetch();
          const since = new Date().toISOString();
          await route.fulfill({ response, json: { ...(await response.json()), monitored: false, since } });
        });
        await page.goto(localePath(locale));
        await expect(page.getByRole('status')).toHaveText(m.status.NONE);
        await expect(page.locator('[data-status="NONE"] [data-testid="badge-detail"]')).toHaveText(/^\s*$/);
      });
    });
  }

  test('with a live reading, says the power is on and for how long', async ({ page }) => {
    await page.route(`**${STATUS_PATH}`, async (route) => {
      const response = await route.fetch();
      const since = new Date(Date.now() - 150 * MINUTE_MS).toISOString();
      await route.fulfill({ response, json: { ...(await response.json()), monitored: true, since } });
    });
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText(en.status.ON);
    // 2 h 29 or 30 min: the app counts from the start of the current minute.
    const lasted = escapeRegExp(en.status.for(`2 ${en.units.h} MM ${en.units.min}`)).replace('MM', '\\d+');
    await expect(page.getByText(new RegExp(`^${lasted}$`))).toBeVisible();
    await expect(page).toHaveTitle(`${en.tab.ON} · ${BRAND}`);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-on.svg');
  });

  test('leads with the ward, names the full brand and says what the measurement covers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.brand.full);
    await expect(page.locator('.gg-eyebrow')).toHaveText(en.masthead.eyebrow);
    const scope = page.getByText(en.scope.measured(site.landmark), { exact: true });
    await expect(scope).toBeVisible();
    await expect(scope.locator('xpath=..').locator('details')).toHaveCount(0);
  });

  test('links fault reports to the configured page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(en.safety.live)).toBeVisible();
    const link = page.getByRole('link', { name: en.safety.report });
    await expect(link).toHaveAttribute('href', site.faultReporting.url);
  });

  test('statistics show durations and say how they are measured', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.gg-trends-body')).toContainText(`0 ${en.units.min}`);
    await expect(page.getByText(en.trends.chartEmpty)).toBeVisible();
    // Too early for a comparison with the previous 30 days.
    await expect(page.getByText(en.trends.change('', '').trim())).toHaveCount(0);
    await page.getByText(en.trends.howTitle).click();
    for (const line of en.trends.how) await expect(page.getByText(line, { exact: true })).toBeVisible();
  });

  test('the footer links the feed and the privacy page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: en.footer.privacy })).toBeVisible();
    await expect(page.getByRole('link', { name: en.footer.feed })).toHaveAttribute('href', FEED_PATH);
    await expect(page.getByRole('link', { name: en.footer.privacy })).toHaveAttribute('href', PRIVACY_PAGE_PATH);
  });

  for (const locale of LOCALES) {
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

  const PAGES: [path: string, loaded: (page: Page) => Locator][] = [
    ['/', (page) => page.getByRole('status')],
    ['/en/', (page) => page.getByRole('status')],
    [PRIVACY_PAGE_PATH, (page) => page.getByRole('heading', { level: 1 }).first()],
    [ADMIN_PAGE_PATH, (page) => page.getByLabel(admin.password)],
  ];
  for (const [path, loaded] of PAGES) {
    test(`${path} loads without CSP violations or console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        // Signed out, /admin's session check is answered 401, and the browser logs the failed request.
        const { pathname } = new URL(message.location().url || 'about:blank');
        if (pathname === ADMIN_OUTAGES_PATH && message.text().includes('401')) return;
        errors.push(`${message.text()} (${message.location().url})`);
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(path);
      await expect(loaded(page)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('says so when the server fails on first load', async ({ page }) => {
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText(en.status.unreachable);
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
  });

  test('keeps the last status and warns when a later poll fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // polls now
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
  });

  test('serves the SEO manifests', async ({ request }) => {
    expect(await (await request.get(ROBOTS_PATH)).text()).toContain(`Disallow: ${ADMIN_API_PREFIX}`);
    const sitemap = await (await request.get(SITEMAP_PATH)).text();
    // The origin is the Worker's SITE_URL, which is local here.
    const locs = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(['/', '/en/', PRIVACY_PAGE_PATH]);
    const og = await request.get(OG_IMAGE_PATH);
    expect(og.headers()['content-type']).toBe('image/png');
  });
});

test.describe('admin', () => {
  test('is kept out of search results', async ({ request }) => {
    expect((await request.get(ADMIN_PAGE_PATH)).headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('rejects a wrong password', async ({ page }) => {
    await page.goto(ADMIN_PAGE_PATH);
    await page.getByLabel(admin.username).fill(ADMIN_USERNAME);
    await page.getByLabel(admin.password).fill('not-the-password');
    await page.getByRole('button', { name: admin.signIn }).click();
    await expect(page.getByRole('alert')).toHaveText(admin.errors.unauthorized);
  });

  test('sets an HttpOnly, Strict session cookie', async ({ page, context }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  });

  test('punch clock drives the public status', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: admin.punchIn })).toHaveCount(0); // only the action that applies
    await page.getByRole('button', { name: admin.punchOut }).click();
    await expect(page.getByTestId('punch-clock')).not.toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: withTime(admin.punchedOut(AT)) })).toBeVisible();
    await expect(page.getByRole('button', { name: admin.punchOut })).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.OFF);
    await expect(page).toHaveTitle(outageTitle(en.tab.OFF));
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-off.svg');
    await page.getByRole('button', { name: en.lang.switchTo }).click();
    await expect(page.getByRole('status')).toContainText(af.status.OFF);
    await expect(page).toHaveTitle(outageTitle(af.tab.OFF));
    await page.getByRole('button', { name: af.lang.switchTo }).click();

    await login(page);
    await page.getByRole('button', { name: admin.punchIn }).click();
    await expect(page.getByTestId('punch-clock')).toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: withTime(admin.punchedIn(AT)) })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
  });

  test('logs a past outage', async ({ page }) => {
    await login(page);
    await page.getByLabel(admin.started).fill('2026-10-01T18:00');
    await page.getByLabel(admin.ended).fill('2026-10-01T20:30');
    await page.getByRole('button', { name: admin.log }).click();
    await expect(page.getByText(`2 ${en.units.h} 30 ${en.units.min} · ${admin.source.manual}`)).toBeVisible();
  });
});

test.describe('share', () => {
  // The page being shared: English readers are on /en/.
  const SHARE_URL = `${site.url}/en/`;
  const TEXT = en.share.text;

  test('links WhatsApp and Telegram with the text and link encoded, in a new tab', async ({ page }) => {
    await page.goto('/');
    const whatsapp = page.getByRole('link', { name: `${en.share.whatsapp} ${en.share.newTab}` });
    await expect(whatsapp).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(`${TEXT} ${SHARE_URL}`)}`);
    const telegram = page.getByRole('link', { name: `${en.share.telegram} ${en.share.newTab}` });
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
    await expect(page.getByRole('button', { name: en.share.copy })).toHaveCount(0);
    await page.getByRole('button', { name: en.share.button }).click();
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
    await expect(page.getByRole('button', { name: en.share.button })).toHaveCount(0);
    await page.getByRole('button', { name: en.share.copy }).click();
    await expect(page.getByText(en.share.copied)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SHARE_URL);
  });
});

test.describe('privacy contact', () => {
  test('reveals the contact email after Turnstile', async ({ page }) => {
    const email = exampleVar('CONTACT_EMAIL');
    await page.goto(PRIVACY_PAGE_PATH);
    // privacy.html's own copy: it is not in the dictionaries.
    const section = page.locator('#en');
    await section.getByRole('button', { name: 'Show email address' }).click();
    const mail = section.getByRole('link', { name: email });
    await expect(mail).toHaveAttribute('href', `mailto:${email}`);
    await expect(mail).toBeFocused();
    await expect(section.getByRole('button', { name: 'Show email address' })).toHaveCount(0);
    await expect(section.getByRole('link', { name: 'open an issue on GitHub' })).toBeVisible();
  });
});

test.describe('admin session', () => {
  test('sign out ends the session', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: admin.signOut }).click();
    await expect(page.getByLabel(admin.password)).toBeVisible();
  });
});

test.describe('site banner', () => {
  // The first banner in src/banners.ts, at a time it shows; nothing to test without one.
  const [banner] = BANNERS;
  test.skip(!banner, 'src/banners.ts has no banners');
  const from = Date.parse(banner?.from ?? '');
  const until = Date.parse(banner?.until ?? '');
  const DURING = new Date((from + until) / 2);
  const copy = (text: Partial<Record<Locale, string>> | undefined, locale: Locale) =>
    text?.[locale] ?? text?.[DEFAULT_LOCALE] ?? '';
  const notice = (page: Page) => page.getByRole('region', { name: en.banner.region });

  test('shows the notice before its end date, in English', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await page.goto('/');
    await expect(notice(page)).toContainText(copy(banner?.text, 'en'));
    await expect(notice(page).getByRole('button', { name: en.banner.dismiss })).toBeVisible();
  });

  test('links to more information in the same tab', async ({ page }) => {
    test.skip(!banner?.link, 'the banner has no link');
    await page.clock.setFixedTime(DURING);
    await page.goto('/');
    const link = notice(page).getByRole('link', { name: copy(banner?.link?.label, 'en') });
    await expect(link).toHaveAttribute('href', banner?.link?.href ?? '');
    await expect(link).not.toHaveAttribute('target', /.*/);
  });

  test.describe('in Afrikaans', () => {
    test.use({ appLocale: 'af' });

    test('is in Afrikaans', async ({ page }) => {
      await page.clock.setFixedTime(DURING);
      await page.goto('/');
      const region = page.getByRole('region', { name: af.banner.region });
      await expect(region).toContainText(copy(banner?.text, 'af'));
      await expect(region.getByRole('button', { name: af.banner.dismiss })).toBeVisible();
    });
  });

  test('is gone once its end date passes', async ({ page }) => {
    await page.clock.setFixedTime(until);
    await page.goto('/');
    await expect(page.getByRole('status')).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test('hides at its end date without a reload', async ({ page }) => {
    await page.clock.install({ time: until - 30_000 });
    await page.goto('/');
    await expect(notice(page)).toBeVisible();
    await page.clock.fastForward('02:00');
    await expect(notice(page)).toHaveCount(0);
  });

  test('stays dismissed across a reload', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    await page.goto('/');
    await notice(page).getByRole('button', { name: en.banner.dismiss }).focus();
    await page.keyboard.press('Enter');
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused(); // focus lands on the content, not <body>
    await page.reload();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), bannerDismissedKey(banner?.id ?? ''))).toBe('1');
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
    const box = await notice(page).boundingBox();
    const footer = await page.locator('.gg-footer').boundingBox();
    expect(card && box && box.y >= card.y + card.height).toBe(true);
    expect(box && footer && footer.y >= box.y + box.height).toBe(true);
  });
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const locale of LOCALES) {
    for (const path of ['/', '/en/', PRIVACY_PAGE_PATH, ADMIN_PAGE_PATH]) {
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

test.describe('outages by time of day', () => {
  /**
   * Serves the real statistics with two weeks (3 outages, then 1 this week) and, unless `byHour`
   * says otherwise, 90 minutes off at 18:00 and 30 at 19:00.
   */
  const withOutages = (page: Page, byHour: Record<number, number> = { 18: 90, 19: 30 }) =>
    page.route(`**${STATS_PATH}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as StatsResponse;
      const last30ByHour = Array.from({ length: 24 }, (_, hour) => byHour[hour] ?? 0);
      const first = body.weeks[0] ?? { weekStart: '2026-10-12', hoursOff: 0, outages: 0 };
      const next = new Date(Date.parse(first.weekStart) + 7 * DAY_MS).toISOString().slice(0, 10);
      const weeks = [
        { ...first, hoursOff: 1, outages: 3 },
        { weekStart: next, hoursOff: 2, outages: 1 },
      ];
      await route.fulfill({ response, json: { ...body, weeks, last30ByHour } });
    });

  test('the weekly chart opens on this week, and Home and the arrow keys move between weeks', async ({ page }) => {
    await withOutages(page);
    await page.goto('/en/');
    const readout = (outages: number) =>
      page.locator('p', { hasText: `${en.trends.off} · ${en.trends.outageCount(outages)}` });
    await expect(page.getByRole('heading', { name: en.trends.chartTitle })).toBeVisible();
    await expect(readout(1).filter({ hasText: en.trends.soFar.trim() })).toHaveCount(1);
    await expect(page.getByText(en.trends.thisWeek, { exact: true })).toBeVisible();
    await page.getByRole('img', { name: en.trends.chartLabel }).focus();
    await page.keyboard.press('Home');
    // The visible readout, and the announcement for screen readers.
    await expect(readout(3)).toHaveCount(2);
    await page.keyboard.press('ArrowRight');
    await expect(readout(1).and(page.locator('[aria-live]'))).toHaveCount(1);
  });

  test('says when the last 30 days had no outages, instead of opening on an empty hour', async ({ page }) => {
    await withOutages(page, {});
    await page.goto('/en/');
    await expect(page.getByRole('heading', { name: en.trends.byHourTitle })).toBeVisible();
    await expect(page.getByText(en.trends.byHourEmpty, { exact: true })).toBeVisible();
  });

  test('opens on the hour with the most time off, and the arrow keys move between hours', async ({ page }) => {
    await withOutages(page);
    await page.goto('/en/');
    await expect(page.getByRole('heading', { name: en.trends.byHourTitle })).toBeVisible();
    const u = en.units;
    await expect(page.getByText(`18:00–19:00: 1 ${u.h} 30 ${u.min} ${en.trends.off}`, { exact: true })).toBeVisible();
    await page.getByRole('img', { name: en.trends.byHourLabel }).focus();
    await page.keyboard.press('ArrowRight');
    // The visible readout, and the announcement a keyboard move makes for screen readers.
    const next = page.getByText(`19:00–20:00: 30 ${u.min} ${en.trends.off}`, { exact: true });
    await expect(next).toHaveCount(2);
    await expect(next.and(page.locator('[aria-live]'))).toHaveCount(1);
  });

  test.describe('af', () => {
    test.use({ appLocale: 'af' });

    test('is in Afrikaans', async ({ page }) => {
      await withOutages(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: af.trends.byHourTitle })).toBeVisible();
      await expect(page.getByRole('img', { name: af.trends.byHourLabel })).toBeVisible();
    });
  });

  for (const locale of LOCALES) {
    test.describe(`${locale} layout`, () => {
      test.use({ appLocale: locale });

      test(`has zero cumulative layout shift while loading with outages on record (${locale})`, async ({ page }) => {
        await withOutages(page);
        await trackLayoutShift(page);
        await page.goto(localePath(locale));
        await expect(page.getByRole('heading', { name: DICTIONARIES[locale].trends.byHourTitle })).toBeVisible();
        expect(await readLayoutShift(page)).toBe(0);
      });
    });
  }
});

test.describe('admin false positives', () => {
  test('marks the ones the sensor dismissed itself', async ({ page }) => {
    const outage = (id: number, dismissedBy: 'sensor' | 'admin') => ({
      id,
      startTime: new Date(Date.now() - (id + 1) * 60 * MINUTE_MS).toISOString(),
      endTime: new Date(Date.now() - id * 60 * MINUTE_MS).toISOString(),
      planned: false,
      source: 'sensor',
      isFalsePositive: true,
      dismissedBy,
    });
    await page.route(`**${ADMIN_OUTAGES_PATH}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { outages: [outage(1, 'sensor'), outage(2, 'admin')] } })
        : route.fallback(),
    );
    await login(page);
    const items = page.getByRole('listitem');
    await expect(items.filter({ hasText: admin.dismissedBySensorTag.trim() })).toHaveCount(1);
    await expect(items.filter({ hasText: admin.falsePositiveTag.trim() })).toHaveCount(2);
  });
});
