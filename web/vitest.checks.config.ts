// npm run check:search (spec 002 task 21): the site's searches against DuckDB
// on the loaded snapshot. It needs the local stack and the cleaned snapshot, so
// it runs on its own instead of in npm test.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

// The same keys the site uses.
const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  resolve: {
    alias: {
      // As in vitest.config.ts: server-only throws on import outside a Next.js build.
      'server-only': path.join(path.dirname(require.resolve('server-only')), 'empty.js'),
    },
  },
  test: {
    include: ['checks/**/*.check.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
