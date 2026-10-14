// The main flows on the local stack (spec 002 task 22). No real author name is
// written here: tests pick names from the page by their role.
import type { Page } from '@playwright/test';
import { expect, hasNoHorizontalScroll, test, total } from './fixtures';

const filters = (page: Page) => page.getByRole('complementary', { name: 'Filters' });

test('the default view lists retractions with every filter counted (AC1, AC2, AC3)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^[\d,]+ retractions$/);
  expect(await total(page)).toBeGreaterThan(0);
  // The summary states both defaults.
  await expect(page.getByText('excluding revised versions').first()).toBeVisible();
  for (const title of [
    'Notice type',
    'Reason',
    'Subject',
    'Country',
    'Publisher',
    'Journal',
    'Article type',
    'Notice year',
    'Paper year',
    'Notice paywalled',
    'Editorial-staff notices',
  ]) {
    await expect(filters(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  // The other notice types and revised versions are counted and one click away.
  await expect(filters(page).getByRole('link', { name: /^Expression of concern, [\d,]+ records?$/ })).toBeVisible();
  await expect(filters(page).getByRole('link', { name: /Include revised versions/ })).toBeVisible();
});

test('filter values include, exclude and come off again (AC3, AC4, AC5)', async ({ page }) => {
  await page.goto('/');
  const start = await total(page);
  await filters(page).getByRole('link', { name: /^Exclude Investigation by Third Party$/ }).click();
  await expect(page).toHaveURL(/not_reason=Investigation\+by\+Third\+Party/);
  await expect.poll(() => total(page)).toBeLessThan(start);
  await page.getByRole('link', { name: /^Remove “.*Investigation by Third Party.*”$/ }).click();
  await expect(page).not.toHaveURL(/not_reason/);
  await expect.poll(() => total(page)).toBe(start);

  await filters(page).getByRole('link', { name: /^Expression of concern, [\d,]+ records?$/ }).click();
  await expect(page).toHaveURL(/type=Expression\+of\+concern/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/retractions and [\d,]+ expressions? of concern/);
});

test('subjects come in named groups that open, and a whole group can be chosen (AC7)', async ({ page }) => {
  await page.goto('/');
  const group = filters(page).getByRole('button', { name: 'Show subjects in Basic Life Sciences (BLS)' });
  await group.click();
  await expect(filters(page).getByRole('link', { name: /^Biology - Cellular, [\d,]+ records?$/ })).toBeVisible();
  await filters(page).getByRole('link', { name: /^Basic Life Sciences \(BLS\), [\d,]+ records?$/ }).click();
  await expect(page).toHaveURL(/subject=BLS(&|$)/);
});

test('filters state their caveats and link to the About page (AC9)', async ({ page }) => {
  await page.goto('/');
  await expect(filters(page).getByText("Retraction Watch's classification")).toBeVisible();
  await expect(filters(page).getByText(/counts overlap and add up to more than the results/)).toBeVisible();
  const readMore = await filters(page).getByRole('link', { name: 'Read more' }).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(readMore).toEqual(expect.arrayContaining(['/about#notice-types', '/about#reasons', '/about#countries', '/about#paywalled', '/about#dates']));
});

test('the search box tolerates a misspelling and says so (AC10, AC13)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('nuerons');
  await expect(page).toHaveURL(/q=nuerons/);
  await expect(page.getByText(/No exact matches for “nuerons”/)).toBeVisible();
  expect(await total(page)).toBeGreaterThan(0);
});

test('an author name shows name matches, with the warning (AC14)', async ({ page }) => {
  await page.goto('/?q=neuron');
  await page.getByRole('link', { name: /^Show records that list the name / }).first().click();
  await expect(page).toHaveURL(/author_name=/);
  await expect(page.getByText('Name matches only.')).toBeVisible();
  expect(await total(page)).toBeGreaterThan(0);
});

test('a result shows its details, every field and links that filter (AC18, AC18a, AC18b)', async ({ page }) => {
  await page.goto('/?q=neuron');
  const first = page.getByRole('main').getByRole('listitem').first();
  await expect(first.getByText('Retraction', { exact: true }).first()).toBeVisible();
  const allFields = first.getByRole('button', { name: 'All fields' });
  await allFields.click();
  await expect(first.getByRole('button', { name: 'Fewer fields' })).toHaveAttribute('aria-expanded', 'true');
  await first.getByRole('link', { name: /^Show only the journal / }).click();
  await expect(page).toHaveURL(/journal=/);
  await expect(page.getByRole('link', { name: /^Remove “/ }).last()).toBeVisible();
});

test('a search with no matches says so and offers to remove each part (AC21)', async ({ page }) => {
  await page.goto('/?author_name=Maria+Example+Nobody');
  await expect(page.getByText('Nothing matches this search.')).toBeVisible();
  // The button below the message; the summary's chip has its own remove link.
  await page.getByRole('main').getByText(/^Remove “listing the author name/).click();
  await expect(page).not.toHaveURL(/author_name/);
  expect(await total(page)).toBeGreaterThan(0);
});

test('a record page shows every field and no search box (AC22)', async ({ page }) => {
  await page.goto('/record/7962');
  await expect(page.getByRole('heading', { name: 'Author names (14)' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy link to this record' })).toBeVisible();
  // Opened directly, there's no way back to results it didn't come from.
  await expect(page.getByRole('button', { name: 'Back to results' })).toHaveCount(0);
});

test('a record opened from a search links back to the results (AC22)', async ({ page }) => {
  await page.goto('/?q=neuron&page=2');
  const title = page.getByRole('main').getByRole('listitem').first().getByRole('link').first();
  await title.click();
  await expect(page).toHaveURL(/\/record\/\d+$/);
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(page).toHaveURL(/\/\?q=neuron&page=2$/);
});

test('every page carries the attribution and the two report links (AC25)', async ({ page }) => {
  for (const path of ['/', '/?q=neuron', '/record/7962', '/about', '/no-such-page']) {
    await page.goto(path);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText('Not affiliated with Retraction Watch or Crossref');
    await expect(footer).toContainText(/Snapshot of \w+ \d+, \d{4}/);
    await expect(footer.getByRole('link', { name: 'gitlab.com/crossref/retraction-watch-data' })).toHaveAttribute(
      'href',
      'https://gitlab.com/crossref/retraction-watch-data',
    );
    await expect(footer.getByRole('link', { name: 'Tell Retraction Watch' })).toHaveAttribute('href', /retractionwatch\.com/);
    const issue = new URL((await footer.getByRole('link', { name: 'Open an issue on GitHub' }).getAttribute('href'))!);
    expect(issue.searchParams.get('body')).toContain(`http://localhost:3100${path === '/?q=neuron' ? '/?q=neuron' : path}`);
    expect(issue.searchParams.get('body')).toMatch(/Data as of: \w+ \d+, \d{4}/);
  }
});

test('the About page explains each caveat (AC26)', async ({ page }) => {
  await page.goto('/about');
  for (const id of ['source', 'defaults', 'counts', 'notice-types', 'reasons', 'countries', 'revisions', 'editorial-staff', 'dates', 'paywalled', 'coverage', 'author-names', 'missing']) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }
  await expect(page.getByText(/released under CC0|under CC0/).first()).toBeVisible();
});

test.describe('at 375 pixels wide (AC31)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('pages fit without scrolling sideways, and filters open in a drawer', async ({ page }) => {
    for (const path of ['/', '/?q=neuron', '/record/7962', '/about']) {
      await page.goto(path);
      expect(await hasNoHorizontalScroll(page), path).toBe(true);
    }
    await page.goto('/');
    await page.getByRole('button', { name: /^Filters/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Filters' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: /^Expression of concern, [\d,]+ records?$/ }).click();
    await expect(page).toHaveURL(/type=Expression\+of\+concern/);
  });
});

test('search and filters work from the keyboard alone (AC32)', async ({ page }) => {
  await page.goto('/');
  // Tab to the search box, type, and wait for the results.
  await tabUntil(page, () => document.activeElement?.getAttribute('type') === 'search');
  await page.keyboard.type('neuron');
  await expect(page).toHaveURL(/q=neuron/);
  // Tab on to a filter value and choose it with Enter.
  await tabUntil(page, () => /^Retraction, [\d,]+ records?/.test(document.activeElement?.getAttribute('aria-label') ?? ''));
  await tabUntil(page, () => /^Expression of concern, [\d,]+ records?/.test(document.activeElement?.getAttribute('aria-label') ?? ''));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/type=Expression\+of\+concern/);
});

async function tabUntil(page: Page, focused: () => boolean, limit = 150) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await page.evaluate(focused)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Nothing matching was reached in ${limit} presses of Tab.`);
}
