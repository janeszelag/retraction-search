// Limits and failures (spec 002 AC28, AC29). The site on port 3100 allows 40
// searches a minute and 2 downloads an hour; port 3101 can't reach Typesense
// and port 3102 can't reach Redis (see playwright.config.ts).
import { COUNTERS_DOWN, SEARCH_DOWN } from '../playwright.config';
import { expect, test, total } from './fixtures';

const SEARCH_LIMIT = 40;

// The limit counts in whole minutes, so a test that needs one window starts early in it.
async function startOfAMinute() {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, left + 500));
  }
}

test('pages say search is unavailable, and keep the attribution, when Typesense is down (AC29)', async ({ page }) => {
  for (const path of ['/?q=neuron', '/record/7962']) {
    await page.goto(`${SEARCH_DOWN}${path}`);
    await expect(page.getByRole('heading', { name: 'Search is unavailable right now' })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('Not affiliated with Retraction Watch or Crossref');
  }
});

test('search keeps working without the rate-limit counters (AC29)', async ({ page }) => {
  await page.goto(`${COUNTERS_DOWN}/?q=neuron`);
  expect(await total(page)).toBeGreaterThan(0);
});

test('past the search limit, the page says when to try again and keeps the query (AC28)', async ({ page }) => {
  test.setTimeout(120_000);
  await startOfAMinute();
  for (let index = 0; index < SEARCH_LIMIT; index += 1) {
    expect((await page.request.get('/?q=neuron')).ok()).toBe(true);
  }
  await page.goto('/?q=neuron&reason=Investigation+by+Journal%2FPublisher');
  // Next.js's route announcer is an alert too, so look inside the page's main content.
  const notice = page.getByRole('main').getByRole('alert');
  await expect(notice).toContainText('Too many searches in a short time');
  await expect(notice).toContainText(/You can search again in \d+ seconds?/);
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('neuron');
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', /q=neuron&reason=/);

  const values = await page.request.get('/api/facet-values?facet=journal&facet_find=nucleic');
  expect(values.status()).toBe(429);
  expect(Number(values.headers()['retry-after'])).toBeGreaterThan(0);
});

test('past the download limit, the page says when to download again (AC28)', async ({ page }) => {
  await page.goto('/?q=neuron');
  const button = page.getByRole('link', { name: 'Download CSV' });
  for (let index = 0; index < 2; index += 1) {
    const download = page.waitForEvent('download');
    await button.click();
    expect((await download).suggestedFilename()).toMatch(/^retraction-search-\d{4}-\d{2}-\d{2}\.csv$/);
  }
  await button.click();
  await expect(page.getByText('Download limit reached')).toBeVisible();
  // One period after the time, also when it ends in "a.m." or "p.m.".
  await expect(
    page.getByText(/Each visitor can download 2 files per hour\. You can download again at (\d{1,2}(:\d{2})? [ap]\.m\.|noon\.|midnight\.) Searching still works\./),
  ).toBeVisible();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
});

// Vercel's firewall answers some requests itself, before the site's code runs
// (spec 004 AC6). These fake its answers, since the local site has no firewall.
test('a 429 from Vercel’s firewall isn’t taken for the download limit (spec 004)', async ({ page }) => {
  await page.route('**/api/export**', (route) =>
    route.fulfill({ status: 429, contentType: 'text/html', headers: { 'x-vercel-mitigated': 'deny' }, body: '<!doctype html><title>429</title>' }),
  );
  await page.goto('/?q=neuron');
  const button = page.getByRole('link', { name: 'Download CSV' });
  await button.click();
  await expect(page.getByText('Too many requests from your network just now. Wait a minute and try again.')).toBeVisible();
  await expect(page.getByText('Download limit reached')).toHaveCount(0);
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

test('a challenge from Vercel opens the download link, so the browser can pass it (spec 004)', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/export**', (route) => {
    requests += 1;
    // The page's own fetch meets the challenge; the browser, opening the link, gets the file.
    return requests === 1
      ? route.fulfill({ status: 429, contentType: 'text/html', headers: { 'x-vercel-mitigated': 'challenge' }, body: '<!doctype html><title>Checkpoint</title>' })
      : route.fulfill({
          status: 200,
          contentType: 'text/csv',
          headers: { 'Content-Disposition': 'attachment; filename="retraction-search-2026-10-23.csv"' },
          body: 'Record ID\n1\n',
        });
  });
  await page.goto('/?q=neuron');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe('retraction-search-2026-10-23.csv');
  expect(requests).toBe(2);
  await expect(page.getByText('Download limit reached')).toHaveCount(0);
});
