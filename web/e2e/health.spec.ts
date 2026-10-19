// GET /api/health, which the hourly site check reads (spec 004 AC9). The site
// on port 3100 allows 40 searches a minute; port 3101 can't reach Typesense
// (see playwright.config.ts).
import { SEARCH_DOWN } from '../playwright.config';
import { expect, test, visitorAddress } from './fixtures';

test('answers with the data date and the default total, past the search limit (spec 004 AC9)', async ({ request }, testInfo) => {
  const headers = { 'X-Forwarded-For': visitorAddress(`${testInfo.testId}:${Date.now()}`) };
  for (let index = 0; index < 45; index += 1) {
    const response = await request.get('/api/health', { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, dataDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(body.total).toBeGreaterThan(0);
  }
});

test('answers 503 when Typesense is down (spec 004 AC9)', async ({ request }) => {
  const response = await request.get(`${SEARCH_DOWN}/api/health`);
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ ok: false, error: 'Search is unavailable right now.' });
});
