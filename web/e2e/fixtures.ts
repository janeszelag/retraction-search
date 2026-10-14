import { createHash } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';

// A made-up address for each test in each run (198.18.0.0/15 is reserved for
// testing), sent as X-Forwarded-For, so each test is its own visitor and rate
// limits don't carry over between tests or runs (plan 002, "Rate limits").
export function visitorAddress(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  return `198.${18 + (hash[0] % 2)}.${hash[1]}.${hash[2]}`;
}

const RUN = `${Date.now()}:${process.pid}`;

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': visitorAddress(`${testInfo.testId}:${testInfo.retry}:${RUN}`) });
    await use(context);
  },
});

export { expect };

// The total above the results, as a number.
export async function total(page: Page): Promise<number> {
  const text = await page.getByRole('heading', { level: 1 }).innerText();
  const match = /^([\d,]+) /.exec(text);
  if (!match) {
    throw new Error(`No total in "${text}"`);
  }
  return Number(match[1].replaceAll(',', ''));
}

export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}
