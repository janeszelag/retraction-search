// Search engines are asked to stay away until SITE_INDEXING is on (spec 004
// AC10). .env.local doesn't set it, so the local build shows the default.
import { expect, test } from './fixtures';

test('robots.txt disallows everything by default (spec 004 AC10)', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toMatch(/^User-Agent: \*\nDisallow: \/\n/);
});

test('every kind of page carries noindex, nofollow by default (spec 004 AC10)', async ({ page }) => {
  for (const path of ['/', '/?q=neuron', '/record/7962', '/about']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex, nofollow');
  }
});
