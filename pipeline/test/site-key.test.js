import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { relativeToRepo } from '../src/paths.js';
import { SITE_KEY, ensureSiteKey, withEnvValue } from '../src/site-key.js';
import { fakeTypesense } from './helpers/fake-typesense.js';

describe('env file', () => {
  it('replaces an existing value and keeps the other lines', () => {
    const text = '# comment\nTYPESENSE_SEARCH_KEY=\nREDIS_URL=redis://localhost:6379\n';
    expect(withEnvValue(text, 'TYPESENSE_SEARCH_KEY', 'abc')).toBe(
      '# comment\nTYPESENSE_SEARCH_KEY=abc\nREDIS_URL=redis://localhost:6379\n',
    );
  });

  it('adds a missing value', () => {
    expect(withEnvValue('A=1', 'TYPESENSE_SEARCH_KEY', 'abc')).toBe('A=1\nTYPESENSE_SEARCH_KEY=abc\n');
    expect(withEnvValue('', 'TYPESENSE_SEARCH_KEY', 'abc')).toBe('TYPESENSE_SEARCH_KEY=abc\n');
  });
});

describe('site key (spec 004, AC4)', () => {
  let root;
  let envFile;
  let typesense;
  let logs;
  const settings = 'TYPESENSE_URL=https://search.example.test\nTYPESENSE_ADMIN_KEY=admin\n';
  const run = () => ensureSiteKey({ request: typesense.request, envFile, log: (line) => logs.push(line) });
  const fileText = () => readFile(envFile, 'utf8');
  const valueOf = (id) => typesense.keys.get(id).value;
  const createKey = async (body) => (await typesense.request('POST', '/keys', { body })).id;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'retraction-search-site-key-'));
    envFile = path.join(root, '.env.hosted');
    typesense = fakeTypesense();
    logs = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates a key that can only search and export, and writes it to the file without printing it', async () => {
    await writeFile(envFile, `${settings}TYPESENSE_SEARCH_KEY=\n`);
    expect(await run()).toEqual({ created: true, id: 1, deleted: [] });

    expect(typesense.keys.get(1)).toMatchObject({
      actions: ['documents:search', 'documents:export'],
      collections: ['retractions', 'meta'],
      description: SITE_KEY.description,
    });
    expect(await fileText()).toBe(`${settings}TYPESENSE_SEARCH_KEY=${valueOf(1)}\n`);
    expect(logs).toEqual([`Created the site's key (id 1) and saved it to ${relativeToRepo(envFile)} as TYPESENSE_SEARCH_KEY.`]);
    expect(logs.join('\n')).not.toContain(valueOf(1));
  });

  it('reuses the key in the file when the server still has it', async () => {
    await writeFile(envFile, settings);
    await run();
    const before = await fileText();
    logs = [];

    expect(await run()).toEqual({ created: false, id: 1, deleted: [] });
    expect(await fileText()).toBe(before);
    expect(typesense.requests.filter((line) => line === 'POST /keys')).toHaveLength(1);
    expect(logs).toEqual([`Reused the site's key in ${relativeToRepo(envFile)} (id 1).`]);
    expect(logs.join('\n')).not.toContain(valueOf(1));
  });

  it('replaces a key in the file that the server no longer has', async () => {
    await writeFile(envFile, settings);
    await run();
    const lost = valueOf(1);
    await typesense.request('DELETE', '/keys/1');
    logs = [];

    expect(await run()).toEqual({ created: true, id: 2, deleted: [] });
    expect(await fileText()).toBe(`${settings}TYPESENSE_SEARCH_KEY=${valueOf(2)}\n`);
    expect(await fileText()).not.toContain(lost);
    expect(logs.join('\n')).not.toContain(valueOf(2));
  });

  it("doesn't reuse a key with the site key's description but other actions", async () => {
    const wider = await createKey({ ...SITE_KEY, actions: [...SITE_KEY.actions, 'documents:delete'] });
    await writeFile(envFile, `${settings}TYPESENSE_SEARCH_KEY=${valueOf(wider)}\n`);

    expect(await run()).toEqual({ created: true, id: 2, deleted: [wider] });
    expect([...typesense.keys.keys()]).toEqual([2]);
  });

  it('deletes older site keys, leaves keys it didn\'t make, and names the deleted keys by id', async () => {
    const older = await createKey(SITE_KEY);
    const someoneElses = await createKey({ description: 'Dashboard', actions: ['documents:search'], collections: ['*'] });
    await writeFile(envFile, settings);

    expect(await run()).toEqual({ created: true, id: 3, deleted: [older] });
    expect([...typesense.keys.keys()].sort()).toEqual([someoneElses, 3]);
    expect(logs[1]).toBe(`Deleted an older site key (id ${older}).`);
    expect(logs.join('\n')).not.toContain(valueOf(3));
  });

  it("creates the file when it doesn't exist", async () => {
    expect(await run()).toMatchObject({ created: true, id: 1 });
    expect(await fileText()).toBe(`TYPESENSE_SEARCH_KEY=${valueOf(1)}\n`);
  });
});
