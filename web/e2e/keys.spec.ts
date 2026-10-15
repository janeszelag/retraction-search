// No key reaches the browser (spec 002 AC27): not in the built browser files,
// not in page HTML, and not in any response the pages and route handlers send.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';

const webDir = fileURLToPath(new URL('../', import.meta.url));

// The keys from the repository's .env.local, where the site and the load read them.
async function keys(): Promise<string[]> {
  const file = await readFile(path.join(webDir, '..', '.env.local'), 'utf8');
  const values = ['TYPESENSE_SEARCH_KEY', 'TYPESENSE_ADMIN_KEY', 'VISITOR_HASH_SALT'].map(
    (name) => new RegExp(`^${name}=(.+)$`, 'm').exec(file)?.[1]?.trim() ?? '',
  );
  return values.filter((value) => value.length >= 8);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

test('the built browser files hold no key', async () => {
  const secrets = await keys();
  expect(secrets.length).toBeGreaterThan(0);
  const files = await filesUnder(path.join(webDir, '.next', 'static'));
  expect(files.length).toBeGreaterThan(0);
  const leaks: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'latin1');
    if (secrets.some((secret) => text.includes(secret))) {
      leaks.push(path.relative(webDir, file));
    }
  }
  expect(leaks).toEqual([]);
});

test('no page or response sends a key', async ({ page }) => {
  const secrets = await keys();
  const leaks: string[] = [];
  const checks: Promise<void>[] = [];
  page.on('response', (response) => {
    // Some bodies never arrive, such as a prefetch the page cancels, so each read has a time limit.
    const body = Promise.race([response.body(), new Promise<Buffer>((_, reject) => setTimeout(() => reject(new Error('no body')), 5000))]);
    checks.push(
      body
        .then((body) => {
          const text = body.toString('latin1') + JSON.stringify(response.headers());
          if (secrets.some((secret) => text.includes(secret))) {
            leaks.push(response.url());
          }
        })
        .catch(() => {}),
    );
  });
  for (const pathname of ['/', '/?q=neuron&reason=Investigation+by+Journal%2FPublisher', '/record/7962', '/about', '/no-such-page']) {
    await page.goto(pathname);
  }
  for (const pathname of ['/api/facet-values?facet=journal&facet_find=nucleic', '/api/export?q=neuron']) {
    const response = await page.request.get(pathname);
    const text = (await response.body()).toString('latin1') + JSON.stringify(response.headers());
    if (secrets.some((secret) => text.includes(secret))) {
      leaks.push(pathname);
    }
  }
  await Promise.all(checks);
  expect(leaks).toEqual([]);
});
