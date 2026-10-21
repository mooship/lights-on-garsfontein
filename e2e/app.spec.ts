import type { APIRequestContext, Cookie, Locator, Page, Route } from '@playwright/test';
import { fill } from '../build/html';
import {
  CREDENTIAL_MAX_LENGTH,
  DAY_MS,
  HEARTBEAT_THRESHOLD_MS,
  HOUR_MS,
  localDate,
  MINUTE_MS,
  OUTAGE_ACTION,
  RECENT_LIMIT,
  type StatsResponse,
  type StatusResponse,
  UTC_OFFSET_MS,
} from '../shared/api';
import { ERROR } from '../shared/errors';
import { DEFAULT_LOCALE, LOCALES, localePath } from '../shared/locale';
import {
  ADMIN_API_PREFIX,
  ADMIN_OUTAGES_PATH,
  ADMIN_PAGE_PATH,
  FEED_PATH,
  OG_IMAGE_PATH,
  OUTAGES_PATH,
  PRIVACY_PAGE_PATH,
  ROBOTS_PATH,
  SECURITY_TXT_PATH,
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
import { REQUEST_TIMEOUT_MS } from '../src/lib/api';
import { PAGE_SIZE } from '../src/lib/pages';
import { STATS_POLL_MS } from '../src/lib/poll';
import { bannerDismissedKey, STORAGE_KEYS } from '../src/lib/storage';
import { PALETTE } from '../src/styles/palette';
import { SESSION_COOKIE } from '../worker/lib/cookies';
import { exampleVar } from './dev-vars';
import {
  ADMIN_API,
  expect,
  logOutage,
  patchJson,
  pollNow,
  readLayoutShift,
  test,
  trackLayoutShift,
  withLocale,
} from './fixtures';

// Copy comes from the dictionaries, so a wording change does not break a test about behaviour.
// One literal per language ('Geen onderbreking aangemeld nie', 'No outage reported') checks the
// dictionaries reach the page at all.

const BRAND = site.brand.short;
/** The tab title without a live reading: it claims no status. */
const NEUTRAL_TITLE = site.brand.full;

/** "rgb(179, 58, 43)" for "#B33A2B", as computed styles report a colour. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
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
        await patchJson<StatusResponse>(page, STATUS_PATH, (body) => {
          const since = new Date().toISOString();
          return { ...body, monitored: false, since };
        });
        await page.goto(localePath(locale));
        await expect(page.getByRole('status')).toHaveText(m.status.NONE);
        await expect(page.locator('[data-status="NONE"] [data-testid="badge-detail"]')).toHaveText(/^\s*$/);
      });
    });
  }

  test('with a live reading, says the power is on and for how long', async ({ page }) => {
    await patchJson<StatusResponse>(page, STATUS_PATH, (body) => {
      const since = new Date(Date.now() - 150 * MINUTE_MS).toISOString();
      return { ...body, monitored: true, since };
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
    // English opens the privacy page at its English section.
    await expect(page.getByRole('link', { name: en.footer.privacy })).toHaveAttribute(
      'href',
      `${PRIVACY_PAGE_PATH}#en`,
    );
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
    // Where it is measured holds in every state, and red stays for measured outages only.
    await expect(page.getByText(en.scope.measured(site.landmark), { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).not.toHaveCSS('color', rgb(PALETTE.light.off));
  });

  test('keeps the statistics card’s shape and disclosures when the statistics fail to load', async ({ page }) => {
    await page.route(`**${STATS_PATH}`, (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } }));
    await page.goto('/en/');
    const failed = page.getByText(en.trends.loadFailed, { exact: true });
    await expect(failed).toBeVisible();
    await expect(failed).not.toHaveCSS('color', rgb(PALETTE.light.off));
    await expect(page.locator('.gg-trends-body')).toBeVisible();
    await expect(page.getByText(en.trends.howTitle, { exact: true })).toBeVisible();
  });

  test('keeps the last status and warns when a later poll fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.route(`**${STATUS_PATH}`, (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } }));
    await pollNow(page);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
  });

  test('stops claiming the power is on once the last reading is older than the heartbeat threshold', async ({
    page,
  }) => {
    await page.clock.install();
    await patchJson<StatusResponse>(page, STATUS_PATH, (body) => {
      const since = new Date(Date.now() - 150 * MINUTE_MS).toISOString();
      return { ...body, status: 'ON', monitored: true, since };
    });
    await page.goto('/en/');
    await expect(page.getByRole('status')).toHaveText(en.status.ON);
    // The power going off often takes the reader's own connection with it.
    await page.unroute(`**${STATUS_PATH}`);
    await page.route(`**${STATUS_PATH}`, (route) => route.abort());
    await pollNow(page);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));
    await expect(page.getByRole('status')).toHaveText(en.status.ON);

    await page.clock.fastForward(HEARTBEAT_THRESHOLD_MS + MINUTE_MS);
    await expect(page.getByRole('status')).toHaveText(en.status.NONE);
    await expect(page.getByTestId('badge-detail')).toHaveText(/^\s*$/);
    await expect(page).toHaveTitle(site.brand.full);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));

    // Out of touch, nothing new arrives, so neither the page nor the tab changes: not with the clock's
    // ticks, the failed status polls, nor a statistics refresh that brings the same figures.
    await page.evaluate(() => {
      const w = window as unknown as { __mutations: number };
      w.__mutations = 0;
      new MutationObserver((records) => {
        w.__mutations += records.length;
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await page.clock.runFor(STATS_POLL_MS + MINUTE_MS);
    expect(await page.evaluate(() => (window as unknown as { __mutations: number }).__mutations)).toBe(0);
  });

  test('gives up on a status request that hangs, and says so', async ({ page }) => {
    await page.clock.install();
    await page.goto('/en/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    await page.route(`**${STATUS_PATH}`, () => {}); // never answers
    await pollNow(page);
    await page.clock.fastForward(REQUEST_TIMEOUT_MS);
    await expect(page.getByRole('alert')).toHaveText(withTime(en.status.stale(AT)));
  });

  // Gentle on readers' phones: the status changes at most once a minute (heartbeats and the cron).
  test('asks for the status once a minute while the page is open', async ({ page }) => {
    await page.clock.install();
    let statusRequests = 0;
    page.on('request', (r) => r.url().endsWith(STATUS_PATH) && statusRequests++);
    await page.goto('/en/');
    await expect(page.getByRole('status')).toContainText(en.status.NONE);
    const before = statusRequests;
    await page.clock.fastForward(MINUTE_MS - 5_000);
    expect(statusRequests).toBe(before);
    await page.clock.fastForward(10_000);
    await expect.poll(() => statusRequests).toBe(before + 1);
  });

  test('refreshes statistics that went stale while the tab was hidden, but not fresh ones', async ({ page }) => {
    await page.clock.install();
    let statsRequests = 0;
    page.on('request', (r) => r.url().endsWith(STATS_PATH) && statsRequests++);
    await page.goto('/en/');
    await expect(page.getByRole('heading', { name: en.trends.title, exact: true })).toBeVisible();
    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);

    await setVisibility('hidden');
    await setVisibility('visible');
    await expect.poll(() => statsRequests).toBe(1); // still fresh: only the first load

    await setVisibility('hidden');
    await page.clock.fastForward(STATS_POLL_MS + MINUTE_MS); // hidden tabs do not poll
    expect(statsRequests).toBe(1);
    await setVisibility('visible');
    await expect.poll(() => statsRequests).toBe(2);
  });

  test('lets browsers keep the icons for a day instead of checking them on every visit', async ({ request }) => {
    for (const path of ['/favicon.svg', '/favicon-on.svg', '/favicon-off.svg', '/favicon.ico']) {
      expect((await request.get(path)).headers()['cache-control'], path).toBe('public, max-age=86400');
    }
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

  test('lets feed readers find the feed from the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute('href', FEED_PATH);
  });

  test('serves security.txt with a contact, an expiry and its canonical URL', async ({ request }) => {
    const response = await request.get(SECURITY_TXT_PATH);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toMatch(/^Contact: https:\/\//m);
    expect(text).toContain(`Expires: ${site.securityTxtExpires}`);
    expect(text).toContain(`Canonical: ${site.url}${SECURITY_TXT_PATH}`);
  });

  for (const path of ['/nope', '/en/nope', '/.well-known/change-password']) {
    test(`answers an unknown path (${path}) with a 404 page that leads home`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      await expect(page.getByRole('link', { name: site.brand.full }).first()).toHaveAttribute('href', '/');
    });
  }

  test('still serves the admin page, which the app renders', async ({ request }) => {
    const response = await request.get(ADMIN_PAGE_PATH);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('id="root"');
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
    // From the keyboard, focus moves to the button that replaces the one pressed.
    await page.getByRole('button', { name: admin.punchOut }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: admin.punchIn })).toBeFocused();
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

test.describe('planned outages', () => {
  /** Opens an outage that began five minutes ago, as an admin would log one; returns its id. */
  async function openOutage(request: APIRequestContext, planned: boolean): Promise<number> {
    const res = await request.post(ADMIN_OUTAGES_PATH, {
      headers: ADMIN_API,
      data: {
        action: OUTAGE_ACTION.create,
        startTime: new Date(Date.now() - 5 * MINUTE_MS).toISOString(),
        endTime: null,
        isPlanned: planned,
      },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { outage: { id: number } }).outage.id;
  }
  const badge = (page: Page) => page.locator('[data-status="OFF"]');
  const history = (page: Page) => page.locator('section', { has: page.locator('#history-heading') });

  for (const locale of LOCALES) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      test(`read as expected, not as an alarm (${locale})`, async ({ page, request }) => {
        const m = DICTIONARIES[locale];
        await openOutage(request, true);
        await page.goto(localePath(locale));
        await expect(page.getByRole('status')).toHaveText(m.status.OFF);
        await expect(badge(page)).toHaveAttribute('data-planned', '');
        // Calm: no pulsing ring, and the planned tone rather than the outage red.
        await expect(badge(page).locator('[aria-hidden="true"] span')).toHaveCount(0);
        await expect(page.getByRole('status')).toHaveCSS('color', rgb(PALETTE.light.planned));
        // Factual: announced in advance, and when it began.
        const DAY = '@@DAY@@';
        const detail = escapeRegExp(m.status.planned(AT, DAY))
          .replaceAll(escapeRegExp(AT), '\\d\\d:\\d\\d')
          .replace(escapeRegExp(DAY), `(${m.day.today}|${m.day.yesterday})`);
        await expect(page.locator('.gg-status-detail > p').first()).toHaveText(new RegExp(`^${detail}$`));
        await expect(history(page).getByText(m.history.planned, { exact: true })).toBeVisible();
      });
    });
  }

  test('an unplanned outage keeps the alarm', async ({ page, request }) => {
    await openOutage(request, false);
    await page.goto('/en/');
    await expect(page.getByRole('status')).toHaveText(en.status.OFF);
    await expect(badge(page)).not.toHaveAttribute('data-planned');
    await expect(badge(page).locator('[aria-hidden="true"] span')).toHaveCount(1);
    await expect(page.getByRole('status')).toHaveCSS('color', rgb(PALETTE.light.off));
    await expect(history(page).getByText(en.history.planned, { exact: true })).toHaveCount(0);
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

  // The link goes in the text: several targets, such as Copy on Windows and Android, keep only the text.
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
      .toEqual({ title: site.brand.full, text: `${TEXT} ${SHARE_URL}` });
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

    test(`card titles wrap without overlapping what follows at 320px (${locale})`, async ({ page }) => {
      await withLocale(page, locale);
      await page.goto(localePath(locale));
      await expect(page.getByRole('status')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const overflowing = await page
        .locator('.gg-card-title')
        .evaluateAll((titles) => titles.filter((t) => t.scrollHeight > t.clientHeight).map((t) => t.textContent));
      expect(overflowing).toEqual([]);
    });
  }
});

test.describe('outages by time of day', () => {
  const OUTAGES_30 = 4;
  /** The time-of-day chart's title for statistics from `withOutages`, which cover a full 30 days. */
  const byHourTitle = (locale: Locale) => DICTIONARIES[locale].trends.byHourTitle(null, OUTAGES_30);
  /** "14 Oct": a plain YYYY-MM-DD date as the charts show it. */
  const calendarDay = (ymd: string) =>
    new Intl.DateTimeFormat(site.intlLocales.en, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
      new Date(`${ymd}T00:00:00Z`),
    );

  /**
   * Serves the real statistics as if tracked for months, with OUTAGES_30 outages in the last 30 days,
   * two weeks (3 outages, then 1 this week) and, unless `byHour` says otherwise, 90 minutes off at
   * 18:00 and 30 at 19:00. `change` adjusts the result.
   */
  const withOutages = (
    page: Page,
    byHour: Record<number, number> = { 18: 90, 19: 30 },
    change: (stats: StatsResponse) => StatsResponse = (stats) => stats,
  ) =>
    patchJson<StatsResponse>(page, STATS_PATH, (body) => {
      const last30ByHour = Array.from({ length: 24 }, (_, hour) => byHour[hour] ?? 0);
      const first = body.weeks[0] ?? { weekStart: '2026-10-12', hoursOff: 0, minutesOff: 0, outages: 0 };
      const next = new Date(Date.parse(first.weekStart) + 7 * DAY_MS).toISOString().slice(0, 10);
      const weeks = [
        { ...first, hoursOff: 1, minutesOff: 60, outages: 3 },
        { weekStart: next, hoursOff: 2, minutesOff: 120, outages: 1 },
      ];
      return change({
        ...body,
        trackingSince: '2026-01-01T00:00:00.000Z',
        last30: { ...body.last30, trackedHours: 30 * 24, outages: OUTAGES_30 },
        weeks,
        last30ByHour,
      });
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

  test('opens on the latest week with an outage, and labels a partial first week by the day records began', async ({
    page,
  }) => {
    let firstDay = '';
    await withOutages(page, undefined, (stats) => {
      const [first, current] = stats.weeks;
      if (!first || !current) throw new Error('withOutages serves two weeks');
      // Records began on the Wednesday of the first week, and this week has had no outage yet.
      firstDay = new Date(Date.parse(first.weekStart) + 2 * DAY_MS).toISOString().slice(0, 10);
      return {
        ...stats,
        trackingSince: new Date(Date.parse(`${firstDay}T00:00:00Z`) - UTC_OFFSET_MS).toISOString(),
        weeks: [first, { ...current, hoursOff: 0, minutesOff: 0, outages: 0 }],
      };
    });
    await page.goto('/en/');
    const partial = en.trends.partial(calendarDay(firstDay)).trim();
    await expect(
      page.locator('p', { hasText: `${en.trends.off} · ${en.trends.outageCount(3)}` }).filter({ hasText: partial }),
    ).toBeVisible();
    await expect(page.getByText(calendarDay(firstDay), { exact: true })).toBeVisible();
  });

  test('gives the time off to the minute, the same as the longest of a single outage', async ({ page }) => {
    const single = { hoursOff: 5.4, minutesOff: 323, outages: 1 };
    await withOutages(page, undefined, (stats) => {
      const [first, current] = stats.weeks;
      if (!first || !current) throw new Error('withOutages serves two weeks');
      return {
        ...stats,
        last30: { ...stats.last30, ...single, longestMinutes: 323 },
        weeks: [
          { ...first, ...single },
          { ...current, hoursOff: 0, minutesOff: 0, outages: 0 },
        ],
      };
    });
    await page.goto('/en/');
    const lasted = `5 ${en.units.h} 23 ${en.units.min}`;
    const tiles = page.locator('.gg-trends-body');
    await expect(tiles).toContainText(`${en.trends.longest}${lasted}`);
    await expect(tiles).toContainText(`${en.trends.withoutPower}${lasted}`);
    await expect(page.locator('p', { hasText: en.trends.outageCount(1) })).toContainText(`${lasted} ${en.trends.off}`);
  });

  test('names the period and the outages the time-of-day chart is based on, until 30 days are on record', async ({
    page,
  }) => {
    const since = Date.now() - 10 * DAY_MS;
    await withOutages(page, { 6: 60 }, (stats) => ({
      ...stats,
      trackingSince: new Date(since).toISOString(),
      last30: { ...stats.last30, trackedHours: 10 * 24, outages: 1 },
    }));
    await page.goto('/en/');
    await expect(
      page.getByRole('heading', { name: en.trends.byHourTitle(calendarDay(localDate(since)), 1), exact: true }),
    ).toBeVisible();
  });

  test('says when the last 30 days had no outages, instead of opening on an empty hour', async ({ page }) => {
    await withOutages(page, {});
    await page.goto('/en/');
    await expect(page.getByRole('heading', { name: byHourTitle('en'), exact: true })).toBeVisible();
    await expect(page.getByText(en.trends.byHourEmpty, { exact: true })).toBeVisible();
  });

  test('opens on the hour with the most time off, and the arrow keys move between hours', async ({ page }) => {
    await withOutages(page);
    await page.goto('/en/');
    await expect(page.getByRole('heading', { name: byHourTitle('en'), exact: true })).toBeVisible();
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
      await expect(page.getByRole('heading', { name: byHourTitle('af'), exact: true })).toBeVisible();
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
        await expect(page.getByRole('heading', { name: byHourTitle(locale), exact: true })).toBeVisible();
        expect(await readLayoutShift(page)).toBe(0);
      });

      // A shift only counts once the shell has painted, which a fast local server can skip, so this
      // compares the boxes themselves.
      test(`keeps the status card the shell's height on a small phone after an outage (${locale})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await patchJson<StatusResponse>(page, STATUS_PATH, (body) => {
          const ended = new Date(Date.now() - 2 * DAY_MS);
          const outage = {
            id: 1,
            startTime: new Date(ended.getTime() - 323 * MINUTE_MS).toISOString(),
            endTime: ended.toISOString(),
            planned: false,
          };
          return { ...body, status: 'ON', monitored: true, since: outage.endTime, recent: [outage] };
        });
        const card = page.locator('.gg-status-card');
        const height = async () => {
          await page.evaluate(() => document.fonts.ready);
          return (await card.boundingBox())?.height;
        };
        await page.goto(localePath(locale));
        await expect(page.getByRole('status')).toHaveText(DICTIONARIES[locale].status.ON);
        const loaded = await height();
        // The display font is cached now, as on most visits; without the app only the shell shows.
        await page.route('**/assets/*.js', (route) => route.abort());
        await page.reload();
        await expect(card.locator('.gg-skel-row')).toBeVisible();
        expect(await height()).toBe(loaded);
      });

      // Below 340px text wraps the most and varies most with the data, so the reserve leaves more room.
      for (const [width, maxGap] of [
        [320, 60],
        [360, 36],
        [1280, 36],
      ] as const) {
        test(`reserves the statistics their loaded height, without a gap, at ${width}px (${locale})`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await withOutages(page);
          const body = page.locator('.gg-trends-body');
          const measure = () =>
            body.evaluate(async (el) => {
              await document.fonts.ready;
              const box = el.getBoundingClientRect();
              const last = el.lastElementChild?.getBoundingClientRect();
              return { height: box.height, gap: box.bottom - (last?.bottom ?? box.bottom) };
            });
          // Twice, so the display font is cached and used from the start, as on most visits.
          await page.goto(localePath(locale));
          await page.evaluate(() => document.fonts.ready);
          await page.reload();
          await expect(page.getByRole('heading', { name: byHourTitle(locale), exact: true })).toBeVisible();
          const loaded = await measure();
          // The reserve is the tallest body in its width range, so a shorter one leaves some room.
          expect(loaded.gap).toBeLessThanOrEqual(maxGap);
          await page.route('**/assets/*.js', (route) => route.abort());
          await page.reload();
          await expect(body.locator('.gg-skel')).not.toHaveCount(0);
          expect((await measure()).height).toBe(loaded.height);
        });
      }
    });
  }
});

test.describe('all outages', () => {
  /** Logs `count` half-hour outages, one a day going back from yesterday; returns their ids, newest first. */
  async function logOutages(request: APIRequestContext, count: number): Promise<number[]> {
    const ids: number[] = [];
    for (let day = 1; day <= count; day++) ids.push(await logOutage(request, day));
    return ids;
  }
  const history = (page: Page) => page.locator('section', { has: page.locator('#history-heading') });
  const rows = (page: Page) => history(page).getByRole('listitem');

  for (const locale of LOCALES) {
    test.describe(locale, () => {
      test.use({ appLocale: locale });

      test(`pages through every outage and back to the recent ones (${locale})`, async ({ page, request }) => {
        const m = DICTIONARIES[locale].history;
        await logOutages(request, PAGE_SIZE + 2);
        await page.goto(localePath(locale));
        await expect(rows(page)).toHaveCount(RECENT_LIMIT);

        const showAll = page.getByRole('button', { name: m.showAll });
        await showAll.click();
        await expect(page.getByRole('heading', { name: m.allTitle })).toBeVisible();
        await expect(rows(page)).toHaveCount(PAGE_SIZE);
        await expect(page.getByRole('status').filter({ hasText: m.page(1, 2) })).toBeVisible();
        const newer = page.getByRole('button', { name: m.newer });
        const older = page.getByRole('button', { name: m.older });
        await expect(newer).toHaveAttribute('aria-disabled', 'true');

        await older.click();
        await expect(rows(page)).toHaveCount(2);
        await expect(page.getByRole('status').filter({ hasText: m.page(2, 2) })).toBeVisible();
        await expect(older).toHaveAttribute('aria-disabled', 'true');
        await expect(older).toBeFocused();
        await older.click({ force: true }); // aria-disabled past the last page, so nothing happens
        await expect(rows(page)).toHaveCount(2);
        await newer.click();
        await expect(rows(page)).toHaveCount(PAGE_SIZE);

        await page.getByRole('button', { name: m.showRecent }).click();
        await expect(page.getByRole('heading', { name: m.title })).toBeVisible();
        await expect(rows(page)).toHaveCount(RECENT_LIMIT);
        await expect(showAll).toBeFocused();
      });

      test(`fits the pager on a 320px screen (${locale})`, async ({ page, request }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await logOutages(request, PAGE_SIZE + 1);
        await page.goto(localePath(locale));
        await page.getByRole('button', { name: DICTIONARIES[locale].history.showAll }).click();
        const pager = page.getByRole('navigation', { name: DICTIONARIES[locale].history.pages });
        await expect(pager).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll).toBeLessThanOrEqual(client);
        // One row: the buttons and the page label all share one line.
        const boxes = await pager.locator(':scope > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
        expect(boxes).toHaveLength(3);
        // Boxes on one line overlap vertically; a wrapped one starts below another's bottom.
        expect(Math.max(...boxes.map((b) => b.top))).toBeLessThan(Math.min(...boxes.map((b) => b.bottom)));
      });

      test(`has zero cumulative layout shift while loading a full recent list (${locale})`, async ({
        page,
        request,
      }) => {
        await logOutages(request, RECENT_LIMIT);
        await trackLayoutShift(page);
        await page.goto(localePath(locale));
        await expect(page.getByRole('button', { name: DICTIONARIES[locale].history.showAll })).toBeVisible();
        expect(await readLayoutShift(page)).toBe(0);
      });
    });
  }

  test('moves the focus to the pages it opens, then keeps the list shut once it is closed', async ({
    page,
    request,
  }) => {
    const [newest] = await logOutages(request, RECENT_LIMIT);
    await page.goto('/');
    await page.getByRole('button', { name: en.history.showAll }).click();
    await expect(page.getByRole('navigation', { name: en.history.pages })).toBeFocused();

    // A reload the status sets off is still on its way when the reader closes the list.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${OUTAGES_PATH}`, async (route) => {
      await held;
      await route.fallback();
    });
    const outagesRequested = page.waitForRequest(`**${OUTAGES_PATH}`);
    await request.post(ADMIN_OUTAGES_PATH, {
      headers: ADMIN_API,
      data: { action: OUTAGE_ACTION.update, id: newest, isPlanned: true },
    });
    await pollNow(page);
    await outagesRequested;
    await page.getByRole('button', { name: en.history.showRecent }).click();
    const outagesAnswered = page.waitForResponse(`**${OUTAGES_PATH}`);
    release();
    await outagesAnswered;
    await expect(page.getByRole('heading', { name: en.history.title })).toBeVisible();
    await expect(page.getByRole('button', { name: en.history.showAll })).toHaveAttribute('aria-disabled', 'false');
  });

  test('says so when a reload of the open list fails, and not once it is closed', async ({ page, request }) => {
    const [newest] = await logOutages(request, RECENT_LIMIT);
    await page.goto('/');
    await page.getByRole('button', { name: en.history.showAll }).click();
    await expect(page.getByRole('heading', { name: en.history.allTitle })).toBeVisible();
    await page.route(`**${OUTAGES_PATH}`, (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } }));
    await request.post(ADMIN_OUTAGES_PATH, {
      headers: ADMIN_API,
      data: { action: OUTAGE_ACTION.update, id: newest, isPlanned: true },
    });
    await pollNow(page);
    await expect(history(page).getByText(en.history.failed)).toBeVisible();
    await page.getByRole('button', { name: en.history.showRecent }).click();
    await expect(history(page).getByText(en.history.failed)).toHaveCount(0);
  });

  test('offers no full list while the recent one holds every outage', async ({ page, request }) => {
    await logOutages(request, RECENT_LIMIT - 1);
    await page.goto('/');
    await expect(rows(page)).toHaveCount(RECENT_LIMIT - 1);
    await expect(page.getByRole('button', { name: en.history.showAll })).toHaveCount(0);
  });

  test('says so when the full list cannot be loaded, and tries again on request', async ({ page, request }) => {
    await logOutages(request, RECENT_LIMIT);
    let fail = true;
    await page.route(`**${OUTAGES_PATH}`, (route) =>
      fail ? route.fulfill({ status: 500, json: { error: ERROR.internal } }) : route.fallback(),
    );
    await page.goto('/');
    const showAll = page.getByRole('button', { name: en.history.showAll });
    await showAll.click();
    await expect(history(page).getByText(en.history.failed)).toBeVisible();
    await expect(rows(page)).toHaveCount(RECENT_LIMIT);
    fail = false;
    await showAll.click();
    await expect(page.getByRole('heading', { name: en.history.allTitle })).toBeVisible();
    await expect(history(page).getByText(en.history.failed)).toHaveCount(0);
  });

  test('reloads the full list when the recent outages change', async ({ page, request }) => {
    const [newest] = await logOutages(request, RECENT_LIMIT);
    await page.goto('/');
    await page.getByRole('button', { name: en.history.showAll }).click();
    await expect(page.getByRole('heading', { name: en.history.allTitle })).toBeVisible();
    await expect(history(page).getByText(en.history.planned)).toHaveCount(0);
    const res = await request.post(ADMIN_OUTAGES_PATH, {
      headers: ADMIN_API,
      data: { action: OUTAGE_ACTION.update, id: newest, isPlanned: true },
    });
    expect(res.status()).toBe(200);
    await pollNow(page);
    await expect(history(page).getByText(en.history.planned)).toHaveCount(1);
  });

  test('keeps the full list while the recent outages stay the same', async ({ page, request }) => {
    await logOutages(request, RECENT_LIMIT);
    await page.goto('/');
    await page.getByRole('button', { name: en.history.showAll }).click();
    await expect(page.getByRole('heading', { name: en.history.allTitle })).toBeVisible();
    let reloads = 0;
    page.on('request', (r) => new URL(r.url()).pathname === OUTAGES_PATH && reloads++);
    for (let poll = 0; poll < 2; poll++) {
      const polled = page.waitForResponse(`**${STATUS_PATH}`);
      await pollNow(page);
      await polled;
    }
    // The status after both polls has rendered, so any reload they started has been requested.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(reloads).toBe(0);
  });
});

test.describe('admin false positives', () => {
  test('marks the ones the sensor dismissed itself', async ({ page }) => {
    const outage = (id: number, dismissedBy: 'sensor' | 'admin') => ({
      id,
      startTime: new Date(Date.now() - (id + 1) * HOUR_MS).toISOString(),
      endTime: new Date(Date.now() - id * HOUR_MS).toISOString(),
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

test.describe('admin sensor', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  /** Answers the dashboard's outage list with `sensor`, and later loads with `next` once it is set. */
  async function mockSensor(page: Page, sensor: { lastSeen: string; pausedUntil: string | null } | null) {
    const later: { next?: (route: Route) => Promise<void> } = {};
    let loads = 0;
    await page.route(`**${ADMIN_OUTAGES_PATH}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      loads++;
      return later.next && loads > 1 ? later.next(route) : route.fulfill({ json: { outages: [], sensor } });
    });
    return later;
  }
  const SINCE = '@@since@@';
  const withSince = (text: string) => new RegExp(`^${escapeRegExp(text).replace(SINCE, '.+')}$`);

  test('says whether the sensor is reporting', async ({ page }) => {
    await mockSensor(page, { lastSeen: ago(30_000), pausedUntil: null });
    await login(page);
    await expect(page.getByText(withSince(admin.sensor.reporting(SINCE)))).toBeVisible();
  });

  test('warns when the sensor has gone silent', async ({ page }) => {
    await mockSensor(page, { lastSeen: ago(12 * MINUTE_MS), pausedUntil: null });
    await login(page);
    await expect(page.getByText(withSince(admin.sensor.silent(`12 ${en.units.min}`, SINCE)))).toBeVisible();
  });

  test('says when no sensor has reported', async ({ page }) => {
    await mockSensor(page, null);
    await login(page);
    await expect(page.getByText(admin.sensor.never)).toBeVisible();
  });

  test('keeps the last reading when a refresh fails, and says so', async ({ page }) => {
    const later = await mockSensor(page, { lastSeen: ago(30_000), pausedUntil: null });
    await login(page);
    later.next = (route) => route.fulfill({ status: 500, json: { error: ERROR.internal } });
    await pollNow(page);
    await expect(page.getByRole('alert')).toHaveText(withTime(admin.sensor.stale(AT)));
    await expect(page.getByText(withSince(admin.sensor.reporting(SINCE)))).toBeVisible();
  });

  test('a refresh after the session has ended shows the sign-in form', async ({ page }) => {
    const later = await mockSensor(page, { lastSeen: ago(30_000), pausedUntil: null });
    await login(page);
    later.next = (route) => route.fulfill({ status: 401, json: { error: ERROR.unauthorized } });
    await pollNow(page);
    await expect(page.getByRole('alert')).toHaveText(admin.errors.session_expired);
    await expect(page.getByLabel(admin.password)).toBeVisible();
    await expect(page.getByRole('heading', { name: admin.punchClock })).toHaveCount(0);
  });
});

test.describe('audit fixes', () => {
  test.describe('af', () => {
    test.use({ appLocale: 'af' });

    test('the Afrikaans footer opens the privacy page at the top', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: af.footer.privacy })).toHaveAttribute('href', PRIVACY_PAGE_PATH);
    });
  });

  test('the admin page has an English title', async ({ page }) => {
    await page.goto(ADMIN_PAGE_PATH);
    await expect(page.getByRole('heading', { name: admin.signInTitle })).toBeVisible();
    await expect(page).toHaveTitle(admin.pageTitle);
  });
});

test.describe('admin keyboard focus', () => {
  test('stays on an outage action while it runs', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: admin.punchOut }).click();
    const planned = page.getByRole('button', { name: admin.planned }).first();
    await planned.focus();
    await page.keyboard.press('Enter');
    await expect(planned).toHaveAttribute('aria-pressed', 'true');
    await expect(planned).toBeFocused();
  });
});

test.describe('unexpected responses', () => {
  // A 200 that is not the expected JSON (a captive portal, a truncated body) is a failure to reach
  // the server, never a reading; the next good answer recovers the page.
  for (const body of ['<html>Sign in to the Wi-Fi</html>', '{}', '{"status":"BROWNOUT","recent":[]}']) {
    test(`treats a status of ${body.slice(0, 20)}… as unreachable, then recovers`, async ({ page }) => {
      await page.route(`**${STATUS_PATH}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body }),
      );
      await page.goto('/en/');
      await expect(page.getByRole('alert')).toHaveText(en.status.unreachable);
      await page.unroute(`**${STATUS_PATH}`);
      await pollNow(page);
      await expect(page.getByRole('status')).toContainText(en.status.NONE);
    });
  }

  test('treats statistics that are not the expected JSON as failing to load', async ({ page }) => {
    await page.route(`**${STATS_PATH}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"trackingSince":null}' }),
    );
    await page.goto('/en/');
    await expect(page.getByText(en.trends.loadFailed, { exact: true })).toBeVisible();
  });

  test('treats statistics without the hourly figures as failing to load', async ({ page }) => {
    await patchJson<Partial<StatsResponse>>(page, STATS_PATH, ({ last30ByHour: _, ...body }) => body);
    await page.goto('/en/');
    await expect(page.getByText(en.trends.loadFailed, { exact: true })).toBeVisible();
  });

  test('limits the sign-in fields to what the server accepts', async ({ page }) => {
    await page.goto(ADMIN_PAGE_PATH);
    await expect(page.locator('#password')).toHaveAttribute('maxlength', String(CREDENTIAL_MAX_LENGTH.password));
    await expect(page.locator('#username')).toHaveAttribute('maxlength', String(CREDENTIAL_MAX_LENGTH.username));
  });

  test('serves the service worker kill switch at /sw.js, never cached', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/javascript/);
    expect(response.headers()['cache-control']).toBe('no-cache');
  });
});
