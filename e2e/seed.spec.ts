import { expect, test } from '@playwright/test';

// Seed for the Playwright planner and generator agents (.claude/agents): the app in English,
// loaded and showing a status. Generated tests start from here; keep it minimal.
test('seed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/');
  await expect(page.getByRole('status').first()).toBeVisible();
});
