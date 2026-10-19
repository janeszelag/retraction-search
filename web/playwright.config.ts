// npm run test:e2e (spec 002 task 22): browser tests on the local stack. The
// script builds the site first; Playwright then starts it three times:
// - port 3100, the site, with lower limits so the limit tests run quickly
// - port 3101, with Typesense unreachable (AC29)
// - port 3102, with Redis unreachable, where search must keep working (AC29)
// Each server reads .env.local through scripts/next.mjs; the variables set here win.
//
// npm run test:live (spec 004 task 7): with SITE_URL set, the only project is
// `live`, which runs the axe tests against that address and starts no
// servers. The limit and failure tests stay local, since they need lowered
// limits and stopped services.
import { defineConfig, devices } from '@playwright/test';

const start = (port: number, env: Record<string, string>) => ({
  command: `node scripts/next.mjs start --port ${port}`,
  url: `http://localhost:${port}/about`,
  env,
  reuseExistingServer: false,
  timeout: 60_000,
});

export const SITE = 'http://localhost:3100';
export const SEARCH_DOWN = 'http://localhost:3101';
export const COUNTERS_DOWN = 'http://localhost:3102';
const LIVE = process.env.SITE_URL;
const chrome = { ...devices['Desktop Chrome'], channel: 'chrome' };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: SITE,
    // The installed Google Chrome, so no browser needs downloading.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: LIVE
    ? [{ name: 'live', testMatch: 'accessibility.spec.ts', use: { ...chrome, baseURL: LIVE } }]
    : [{ name: 'chrome', use: chrome }],
  webServer: LIVE
    ? []
    : [
        start(3100, { RATE_LIMIT_SEARCHES: '40', RATE_LIMIT_DOWNLOADS: '2' }),
        // Port 9 is the discard port: nothing answers there.
        start(3101, { TYPESENSE_URL: 'http://127.0.0.1:9' }),
        start(3102, { REDIS_URL: 'redis://127.0.0.1:9' }),
      ],
});
