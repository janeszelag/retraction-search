// Runs the Next.js command line with the repository's .env.local loaded first,
// so the site, the pipeline and Docker share one env file. Loading it before
// Next.js starts keeps the values when Next.js reloads its own env files.
// Hosts that set variables themselves have no .env.local, and nothing changes.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const envFile = new URL('../../.env.local', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const require = createRequire(import.meta.url);
await import(require.resolve('next/dist/bin/next'));
