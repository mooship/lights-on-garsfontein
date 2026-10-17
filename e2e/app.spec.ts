import { type Cookie, expect, type Page, test } from '@playwright/test';

// Tests share one local database and run in order.
test.describe.configure({ mode: 'serial' });

const ADMIN_USERNAME = 'admin'; // matches .dev.vars.example
const ADMIN_PASSWORD = 'test-password';

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

  test('a saved preference beats the system theme and the toggle persists it', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
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

test.describe('public page', () => {
  test('shows power on by default without a sensor', async ({ page }) => {
    await page.goto('/');
    const status = page.getByRole('status');
    await expect(status).toContainText('Power is on');
    await expect(page.getByText(/by hand|sensor/i)).toHaveCount(0); // never says how outages are recorded
    await expect(page.getByRole('heading', { name: 'By the numbers' })).toBeVisible();
  });

  test('has zero cumulative layout shift while loading', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await expect(page.getByRole('status')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
  });

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
    await expect(page.getByRole('alert')).toHaveText('Couldn’t reach the server. Trying again shortly…');
    await expect(page.getByRole('heading', { name: 'By the numbers' })).toBeVisible();
  });

  test('keeps the last status and warns when a later poll fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Power is on');
    await expect(page.getByText(/^Updated \d\d:\d\d$/)).toBeVisible();
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, json: { error: 'internal_error' } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // polls now
    await expect(page.getByRole('alert')).toHaveText(/^Can’t reach the server\. Showing status from \d\d:\d\d\.$/);
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
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password.');
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
    await expect(page).toHaveTitle(/^OFF \d+m · Lights On\?$/);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon-off.svg');

    await login(page);
    await page.getByRole('button', { name: 'Punch in' }).click();
    await expect(page.getByTestId('punch-clock')).toHaveText('00:00:00');
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Power is on');
    await expect(page).toHaveTitle('ON · Lights On?');
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

    await page.goto('/');
    // Cloudflare's test site key passes Turnstile without a challenge.
    await page.getByTestId('confirm-outage').click();
    await expect(page.getByTestId('confirm-outage')).toHaveText('Thanks for letting us know', { timeout: 20_000 });
    await expect(page.getByText('1 neighbour says theirs is off too.')).toBeVisible();

    // Same client again: one confirmation per outage, then 5 requests per minute.
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await request.post('/api/confirm', { data: { token: 'XXXX.DUMMY.TOKEN' } })).status());
    }
    expect(codes).toEqual([409, 409, 409, 409, 429]);
  });
});

test.describe('admin session', () => {
  test('sign out ends the session', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});
