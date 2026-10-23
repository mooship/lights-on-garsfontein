import type { Page } from '@playwright/test';
import { MINUTE_MS, type StatsResponse, type StatusResponse } from '../shared/api';
import { STATS_PATH, STATUS_PATH } from '../shared/paths';
import { en } from '../src/i18n/en';
import { STATS_POLL_MS } from '../src/lib/poll';
import { expect, logOutage, patchJson, pollNow, test } from './fixtures';

type MotionWindow = Window & { __animated: Element[] };

/** Records every element a CSS animation starts on, from the start of the load; call before `goto`. */
const recordAnimations = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as MotionWindow;
    w.__animated = [];
    document.addEventListener('animationstart', (event) => w.__animated.push(event.target as Element), true);
  });

/** How many animations have started on elements matching `selector`, once the next frames have painted. */
const animated = (page: Page, selector: string) =>
  page.evaluate(async (sel) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (window as unknown as MotionWindow).__animated.filter((el) => el.matches(sel)).length;
  }, selector);

/** Serves the status with a live reading, as `status()` says it is. */
const withStatus = (page: Page, status: () => 'ON' | 'OFF') =>
  patchJson<StatusResponse>(page, STATUS_PATH, (body) => {
    const since = new Date(Date.now() - 10 * MINUTE_MS).toISOString();
    return { ...body, status: status(), monitored: true, since };
  });

test.describe('motion', () => {
  test('with reduced motion, nothing moves for longer than an instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withStatus(page, () => 'OFF');
    await page.route(`**${STATS_PATH}`, () => {}); // keeps the statistics loading, shimmer and all
    await page.goto('/en/');
    await expect(page.getByRole('status')).toHaveText(en.status.OFF);
    await expect(page.locator('.gg-skel').first()).toBeVisible();
    const lasting = await page.evaluate(() =>
      document
        .getAnimations()
        .map((a) => Number(a.effect?.getComputedTiming().endTime))
        .filter((end) => end > 1),
    );
    expect(lasting).toEqual([]);
  });

  test('marks a change of status, but not the first status shown', async ({ page }) => {
    await page.clock.install();
    const changed = '[data-status] > [aria-hidden="true"], [data-status] [role="status"] > *';
    let status: 'ON' | 'OFF' = 'ON';
    await withStatus(page, () => status);
    await recordAnimations(page);
    await page.goto('/en/');
    await expect(page.getByRole('status')).toHaveText(en.status.ON);
    expect(await animated(page, changed)).toBe(0);

    status = 'OFF';
    await pollNow(page);
    await expect(page.getByRole('status')).toHaveText(en.status.OFF);
    await expect.poll(() => animated(page, changed)).toBeGreaterThan(0);
  });

  test('brings in an outage a poll adds, but not the ones already listed', async ({ page, request }) => {
    await page.clock.install();
    const rows = page.locator('section:has(#history-heading) li');
    await logOutage(request, 2);
    await recordAnimations(page);
    await page.goto('/en/');
    await expect(rows).toHaveCount(1);

    const unchanged = page.waitForResponse(`**${STATUS_PATH}`);
    await pollNow(page);
    await unchanged;
    expect(await animated(page, 'li')).toBe(0);

    await logOutage(request, 1);
    await pollNow(page);
    await expect(rows).toHaveCount(2);
    await expect.poll(() => animated(page, 'li')).toBe(1);
  });

  test('grows the chart bars once, not again when the statistics refresh', async ({ page }) => {
    await page.clock.install();
    await patchJson<StatsResponse>(page, STATS_PATH, (body) => {
      const week = body.weeks.at(-1) ?? { weekStart: '2026-10-12', hoursOff: 0, minutesOff: 0, outages: 0 };
      const weeks = [{ ...week, hoursOff: 2, minutesOff: 120, outages: 1 }];
      return { ...body, trackingSince: '2026-01-01T00:00:00.000Z', weeks };
    });
    await recordAnimations(page);
    await page.goto('/en/');
    await expect.poll(() => animated(page, 'rect[data-bar]')).toBeGreaterThan(0);
    const grown = await animated(page, 'rect[data-bar]');

    const refreshed = page.waitForResponse(`**${STATS_PATH}`);
    await page.clock.fastForward(STATS_POLL_MS);
    await refreshed;
    expect(await animated(page, 'rect[data-bar]')).toBe(grown);
  });
});
