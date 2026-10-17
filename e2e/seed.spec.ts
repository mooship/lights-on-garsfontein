import { expect, test } from './fixtures';

// Seed for the Playwright planner and generator agents (.claude/agents): the app in English with
// no outages (the fixtures), loaded and showing a status. Generated tests start from here; keep it minimal.
test('seed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status').first()).toBeVisible();
});
