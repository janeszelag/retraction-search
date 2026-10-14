// Automated accessibility check (spec 002 AC32): axe finds no WCAG 2.2 AA
// violations on the start, results, no-results and record pages, and About.
//
// The year bars are narrower than 24px, which axe's target-size rule reports.
// WCAG 2.5.8 exempts a target when another control on the page does the same
// thing, and each year filter's "from" and "to" inputs do. axe can't see that,
// so the bars skip only that one rule; every other rule still checks them.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const YEAR_BARS = '[role="group"][aria-label^="Records per"]';

const PAGES = [
  ['start', '/'],
  ['results', '/?q=neuron&reason=Investigation+by+Journal%2FPublisher'],
  ['no results', '/?author_name=Maria+Example+Nobody'],
  ['record', '/record/7962'],
  ['about', '/about'],
] as const;

for (const [name, path] of PAGES) {
  test(`the ${name} page has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(path);
    const everyOtherRule = await new AxeBuilder({ page }).withTags(TAGS).disableRules(['target-size']).analyze();
    const targetSize = await new AxeBuilder({ page }).withRules(['target-size']).exclude(YEAR_BARS).analyze();
    const violations = [...everyOtherRule.violations, ...targetSize.violations];
    expect(violations.map(({ id, help, nodes }) => `${id}: ${help} (${nodes.length}: ${nodes[0]?.target.join(' ')})`)).toEqual([]);
  });
}
