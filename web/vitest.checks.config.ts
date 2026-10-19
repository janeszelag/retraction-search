// npm run check:search (spec 002 task 21): the site's searches against DuckDB
// on the loaded snapshot. It needs a search server and the cleaned snapshot,
// so it runs on its own instead of in npm test.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

// The same keys the site uses: from the file given with --server-env
// (scripts/check-search.mjs), or else .env.local.
const envFile = process.env.CHECK_SERVER_ENV ?? fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
} else if (process.env.CHECK_SERVER_ENV) {
  throw new Error(`Can't find ${envFile}.`);
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
