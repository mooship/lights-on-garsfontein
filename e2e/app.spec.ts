import { readFileSync } from 'node:fs';
import type { Cookie, Locator, Page } from '@playwright/test';
import { fill } from '../build/html';
import { localePath } from '../shared/locale';
import { type Locale, site } from '../site.config';
import { BANNERS } from '../src/banners';
import { DICTIONARIES } from '../src/i18n';
import { af } from '../src/i18n/af';
import { en } from '../src/i18n/en';
import { HEAD } from '../src/i18n/head';
import { cacheName, STATUS_CACHE } from '../src/sw/strategy';
import { exampleVar } from './dev-vars';
import { expect, readLayoutShift, test, trackLayoutShift, withLocale } from './fixtures';

// Copy comes from the dictionaries, so a wording change does not break a test about behaviour.
// One literal per language ('Geen onderbreking aangemeld nie', 'No outage reported') checks the
// dictionaries reach the page at all.

const DEFAULT_LOCALE = site.locales[0];
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

const ADMIN_USERNAME = 'admin'; // matches .dev.vars.example
const ADMIN_PASSWORD = 'test-password';

// Public copy never says how an outage was recorded, in either language.
const RECORDING_METHOD = /by hand|sensor|met die hand|handmatig|voeler/i;

// Log in through the UI once and reuse the cookie: the login endpoint allows 5 attempts a minute.
let sessionCookies: Cookie[] = [];

async function login(page: Page) {
  if (sessionCookies.length) await page.context().addCookies(sessionCookies);
  await page.goto('/admin');
  const dashboard = page.getByRole('heading', { name: en.admin.punchClock });
  const password = page.getByLabel(en.admin.password);
  await expect(dashboard.or(password)).toBeVisible();
  if (await dashboard.isVisible()) return; // session cookie still valid
  await page.getByLabel(en.admin.username).fill(ADMIN_USERNAME);
  await password.fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: en.admin.signIn }).click();
  await expect(dashboard).toBeVisible();
  sessionCookies = (await page.context().cookies()).filter((c) => c.name === '__Host-admin_session');
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
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('theme', 'light');
        sessionStorage.setItem('seeded', '1');
      }
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);

    await page.getByRole('button', { name: en.theme.toDark }).click();
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
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('en');

    await page.getByRole('button', { name: en.lang.switchTo }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status')).toContainText(af.status.NONE);
    expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('af');

    // Back returns to the English URL, and the language follows it.
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await context.close();
  });

  test('opens / at /en/ for a visitor who chose English, before the app renders', async ({ page }) => {
    const statusFetchedFrom: string[] = [];
    page.on('request', (r) => r.url().endsWith('/api/status') && statusFetchedFrom.push(r.frame().url()));
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
      expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('en');
    });
  });

  test('/en redirects to /en/', async ({ request }) => {
    const res = await request.get('/en', { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(res.status());
    expect(res.headers().location).toBe('/en/');
  });

  for (const locale of site.locales) {
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
    // No "for 7 h": nothing measured it on. No outage is on record, so no "Last outage ended" either.
    await expect(page.getByText(new RegExp(`^${escapeRegExp(en.status.for(''))}\\d`))).toHaveCount(0);
    await expect(page.getByText(withTime(en.status.lastEnded(AT, en.day.today)))).toHaveCount(0);
    await expect(page.locator('[data-status="NONE"]')).toBeVisible();
    // Just the one line of detail: no "Updated HH:MM" while all is well.
    await expect(page.locator('.gg-status-detail > p')).toHaveCount(1);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.getByText(RECORDING_METHOD)).toHaveCount(0); // never says how outages are recorded
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
  });

  for (const locale of site.locales) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      test(`without a live reading, says when the last outage ended (${locale})`, async ({ page }) => {
        const m = DICTIONARIES[locale];
        await page.route('**/api/status', async (route) => {
          const response = await route.fetch();
          const since = new Date().toISOString();
          await route.fulfill({ response, json: { ...(await response.json()), monitored: false, since } });
        });
        await page.goto(localePath(locale));
        await expect(page.getByRole('status')).toHaveText(m.status.NONE);
        await expect(page.getByText(withTime(m.status.lastEnded(AT, m.day.today)))).toBeVisible();
      });
    });
  }

  test('with a live reading, says the power is on and for how long', async ({ page }) => {
    await page.route('**/api/status', async (route) => {
      const response = await route.fetch();
      const since = new Date(Date.now() - 150 * 60_000).toISOString();
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
    await expect(page.getByText(en.scope.measured(site.landmark), { exact: true })).toBeVisible();
    await page.getByText(en.scope.why, { exact: true }).click();
    await expect(page.getByText(en.scope.whyText, { exact: true })).toBeVisible();
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

  test('the footer links the feed and the privacy page, and not the data licence', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: en.footer.privacy })).toBeVisible();
    await expect(page.getByRole('link', { name: site.dataLicence.name })).toHaveCount(0);
    await expect(page.getByRole('link', { name: en.footer.feed })).toHaveAttribute('href', '/feed.xml');
    await expect(page.getByRole('link', { name: en.footer.privacy })).toHaveAttribute('href', '/privacy');
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

  const PAGES: [path: string, loaded: (page: Page) => Locator][] = [
    ['/', (page) => page.getByRole('status')],
    ['/en/', (page) => page.getByRole('status')],
    ['/privacy', (page) => page.getByRole('heading', { level: 1 }).first()],
    ['/admin', (page) => page.getByLabel(en.admin.password)],
  ];
  for (const [path, loaded] of PAGES) {
    test(`${path} loads without CSP violations or console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        // Signed out, /admin's session check is answered 401, and the browser logs the failed request.
        const { pathname } = new URL(message.location().url || 'about:blank');
        if (pathname === '/api/admin/outages' && message.text().includes('401')) return;
        errors.push(`${message.text()} (${message.location().url})`);
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(path);
      await expect(loaded(page)).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('says so when the server fails on first load', async ({ page }) => {
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText(en.status.unreachable);
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
  });

  test('keeps the last status and warns when a later poll fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // polls now
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
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
    await page.getByLabel(en.admin.username).fill(ADMIN_USERNAME);
    await page.getByLabel(en.admin.password).fill('not-the-password');
    await page.getByRole('button', { name: en.admin.signIn }).click();
    await expect(page.getByRole('alert')).toHaveText(en.admin.errors.unauthorized);
  });

  test('sets an HttpOnly, Strict session cookie', async ({ page, context }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name === '__Host-admin_session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  });

  test('punch clock drives the public status', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: en.admin.punchIn })).toHaveCount(0); // only the action that applies
    await page.getByRole('button', { name: en.admin.punchOut }).click();
    await expect(page.getByTestId('punch-clock')).not.toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: withTime(en.admin.punchedOut(AT)) })).toBeVisible();
    await expect(page.getByRole('button', { name: en.admin.punchOut })).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.OFF);
    await expect(page).toHaveTitle(outageTitle(en.tab.OFF));
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-off.svg');
    await page.getByRole('button', { name: en.lang.switchTo }).click();
    await expect(page.getByRole('status')).toContainText(af.status.OFF);
    await expect(page).toHaveTitle(outageTitle(af.tab.OFF));
    await page.getByRole('button', { name: af.lang.switchTo }).click();

    await login(page);
    await page.getByRole('button', { name: en.admin.punchIn }).click();
    await expect(page.getByTestId('punch-clock')).toHaveText('00:00:00');
    await expect(page.getByRole('status').filter({ hasText: withTime(en.admin.punchedIn(AT)) })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page).toHaveTitle(NEUTRAL_TITLE);
  });

  test('logs a past outage', async ({ page }) => {
    await login(page);
    await page.getByLabel(en.admin.started).fill('2026-10-01T18:00');
    await page.getByLabel(en.admin.ended).fill('2026-10-01T20:30');
    await page.getByRole('button', { name: en.admin.log }).click();
    await expect(page.getByText(`2 ${en.units.h} 30 ${en.units.min} · ${en.admin.source.manual}`)).toBeVisible();
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
    await page.goto('/privacy');
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
    await page.getByRole('button', { name: en.admin.signOut }).click();
    await expect(page.getByLabel(en.admin.password)).toBeVisible();
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
    expect(await page.evaluate((id) => localStorage.getItem(`banner-dismissed:${id}`), banner?.id)).toBe('1');
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
    await expect(page.getByRole('status')).toContainText(af.status.NONE);
    await expect(page.getByRole('alert')).toHaveCount(0);
    // This build's shell, named after the build id in sw.js, and the status copy beside it.
    const keys = (await page.evaluate(() => caches.keys())).sort();
    expect(keys).toEqual([STATUS_CACHE, expect.stringMatching(`^${cacheName('')}`)].sort());
    const buildId = keys.find((key) => key !== STATUS_CACHE)?.slice(cacheName('').length);
    expect(readFileSync('dist/sw.js', 'utf8')).toContain(`\`${buildId}\``);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'af');
    await expect(page.getByRole('status')).toContainText(af.status.NONE);
    await expect(page.getByRole('alert')).toHaveText(withTime(af.status.offline(AT)));

    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.offline(AT)));

    // A copy from another day says which day.
    await page.evaluate(async (status) => {
      const copy = (await caches.match('/api/status')) as Response;
      const body = { ...(await copy.json()), generatedAt: new Date(Date.now() - 86_400_000).toISOString() };
      await (await caches.open(status)).put('/api/status', new Response(JSON.stringify(body), copy));
    }, STATUS_CACHE);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.offline(AT, en.day.yesterday)));

    await context.setOffline(false);
    await poll(page);
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
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.offline(AT)), { timeout: 4_500 });
    await expect.poll(() => cachedGeneratedAt(page), { timeout: 10_000 }).toBe(stamp); // kept for next time

    await context.unroute('**/api/status');
    await context.route('**/api/status', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
    await poll(page);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.offline(AT)));

    await context.unroute('**/api/status');
    await poll(page);
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
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(0);
  });

  test('keeps /admin, writes and the rest of the API out of the cache', async ({ page, context }) => {
    await throughServiceWorker(page, '/');
    await page.goto('/admin');
    await expect(page.getByRole('button', { name: af.admin.signIn })).toBeVisible();
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
