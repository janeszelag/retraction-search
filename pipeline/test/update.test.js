import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { redact, runUpdate } from '../src/update.js';
import { fakeGitlab } from './helpers/fake-gitlab.js';
import { fakeTypesense } from './helpers/fake-typesense.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// Two upstream commits: sample.csv on 2026-10-13, then sample-next.csv on 2026-10-14.
const OLDER = {
  id: 'a'.repeat(40),
  title: 'Retraction Watch data for 2026-10-13',
  committed_date: '2026-10-13T23:00:41.000+00:00',
  file: fixture('sample.csv'),
};
const NEWER = {
  id: 'b'.repeat(40),
  title: 'Retraction Watch data for 2026-10-14',
  committed_date: '2026-10-14T23:00:20.000+00:00',
  file: fixture('sample-next.csv'),
};

let root;
let runs = 0;
let now;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'retraction-search-update-'));
  now = clock();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A clock that moves a minute on each reading, starting at 01:17 UTC on 2026-10-15.
// One per test, so runs in a test never share a collection name.
function clock() {
  let minutes = 0;
  return () => new Date(Date.UTC(2026, 9, 15, 1, 17 + minutes++));
}

// Each run gets fresh folders, as on a new GitHub runner (AC3).
function update(typesense, commits, options = {}) {
  runs += 1;
  const dir = (name) => path.join(root, `run-${runs}`, name);
  const gitlab = fakeGitlab(commits);
  const promise = runUpdate({
    request: typesense.request,
    fetch: gitlab.fetch,
    now,
    rawDir: dir('raw'),
    cleanDir: dir('clean'),
    diffDir: dir('diff'),
    runsDir: dir('runs'),
    log: () => {},
    ...options,
  });
  return promise.then((result) => ({ result, gitlab }));
}

const writes = (requests) => requests.filter((line) => /^(POST|PUT|DELETE|PATCH) /.test(line));

describe('one command (AC1, AC3)', () => {
  it('loads the newest snapshot into an empty server, with nothing to compare against', async () => {
    const typesense = fakeTypesense();
    const { result } = await update(typesense, [OLDER]);

    expect(result).toMatchObject({ outcome: 'updated', step: null, before: null, diff: null });
    expect(result.after).toMatchObject({ data_date: '2026-10-13', commit: 'aaaaaaaa', upstream_commit: OLDER.id });
    expect(result.diff_note).toBe('Nothing to compare against: the server had no loaded snapshot.');
    expect(typesense.aliases.get('retractions')).toBe(result.after.collection);
    expect(typesense.collections.get(result.after.collection).docs.size).toBe(37);

    const summary = await readFile(path.join(result.run_folder, 'summary.md'), 'utf8');
    expect(summary).toMatch(/^# Updated to 2026-10-13 \(upstream commit aaaaaaaa\)\n/);
    expect(summary).toContain('Nothing to compare against: the server had no loaded snapshot.');
    expect(JSON.parse(await readFile(path.join(result.run_folder, 'result.json'), 'utf8'))).toMatchObject({
      outcome: 'updated',
      after: { upstream_commit: OLDER.id },
    });
  });

  it('moves to a newer snapshot on a fresh machine, diffing against the commit in the meta document', async () => {
    const typesense = fakeTypesense();
    const first = await update(typesense, [OLDER]);
    const { result, gitlab } = await update(typesense, [NEWER, OLDER]);

    expect(result.outcome).toBe('updated');
    expect(result.before).toMatchObject({ upstream_commit: OLDER.id, collection: first.result.after.collection });
    expect(result.after).toMatchObject({ data_date: '2026-10-14', upstream_commit: NEWER.id });
    // The loaded snapshot came from the meta document and was downloaded again.
    expect(gitlab.requests).toContain(`GET /crossref/retraction-watch-data/-/raw/${OLDER.id}/retraction_watch.csv`);
    expect(result.diff).toMatchObject({ added: 2, removed: 1, changed: 5, emptied: 1 });

    const summary = await readFile(path.join(result.run_folder, 'summary.md'), 'utf8');
    expect(summary).toContain('## Changes from 2026-10-13 (upstream commit aaaaaaaa) to 2026-10-14 (upstream commit bbbbbbbb)');
    expect(summary).toContain('| 18 | Expression of concern | Retraction |');
    // The previous collection stays, so going back is one alias switch.
    expect([...typesense.collections.keys()].sort()).toEqual(
      ['meta', first.result.after.collection, result.after.collection].sort(),
    );
  });

  it('loads without a diff when the meta document has no upstream commit', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    const meta = typesense.collections.get('meta').docs.get('current');
    delete meta.upstream_commit;

    const { result } = await update(typesense, [NEWER, OLDER]);
    expect(result.outcome).toBe('updated');
    expect(result.diff).toBeNull();
    expect(result.diff_note).toContain('doesn’t record the loaded snapshot’s upstream commit');
  });
});

describe('already up to date, --force and --commit (AC2)', () => {
  it('says so, exits successfully and writes nothing when the server has the newest snapshot', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [NEWER, OLDER]);
    typesense.requests.length = 0;

    const { result, gitlab } = await update(typesense, [NEWER, OLDER]);
    expect(result.outcome).toBe('up-to-date');
    expect(result.after).toBeNull();
    expect(writes(typesense.requests)).toEqual([]);
    expect(gitlab.requests.filter((line) => line.includes('/-/raw/'))).toEqual([]);
    expect(await readFile(path.join(result.run_folder, 'summary.md'), 'utf8')).toMatch(
      /^# Up to date: 2026-10-14 \(upstream commit bbbbbbbb\)\n/,
    );
  });

  it('loads the newest snapshot again with --force', async () => {
    const typesense = fakeTypesense();
    const first = await update(typesense, [NEWER, OLDER]);
    const { result } = await update(typesense, [NEWER, OLDER], { force: true });

    expect(result).toMatchObject({ outcome: 'updated', message: null });
    expect(result.after.collection).not.toBe(first.result.after.collection);
    expect(result.diff).toMatchObject({ added: 0, removed: 0, changed: 0, emptied: 0 });
  });

  it('loads a given upstream commit with --commit, to roll back', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [NEWER, OLDER]);
    const { result } = await update(typesense, [NEWER, OLDER], { commit: 'aaaaaaaa' });

    expect(result.outcome).toBe('updated');
    expect(result.requested_commit).toBe('aaaaaaaa');
    expect(result.after).toMatchObject({ data_date: '2026-10-13', upstream_commit: OLDER.id });
    expect(result.diff).toMatchObject({ added: 1, removed: 2 });
  });
});

describe('search keys (AC18)', () => {
  it('never sends a request to /keys', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    await update(typesense, [NEWER, OLDER]);
    await update(typesense, [NEWER, OLDER]);
    await update(typesense, [NEWER, OLDER], { force: true });
    expect(typesense.requests.filter((line) => line.includes('/keys'))).toEqual([]);
  });
});

describe('secrets in messages (AC17)', () => {
  it('hides the server address and key', () => {
    expect(redact("Can't reach Typesense at https://search.example.app (ECONNREFUSED).", ['https://search.example.app', 'k3y'])).toBe(
      "Can't reach Typesense at [hidden] (ECONNREFUSED).",
    );
  });

  it('hides them in a failed run’s result', async () => {
    const typesense = fakeTypesense();
    const { TypesenseError } = await import('../src/typesense.js');
    typesense.failRequest = () => new TypesenseError("Can't reach Typesense at https://search.example.app (ECONNREFUSED).");
    const { result } = await update(typesense, [OLDER], { secrets: ['https://search.example.app'] });
    expect(result).toMatchObject({ outcome: 'failed', step: 'read the server' });
    expect(result.message).toBe("Can't reach Typesense at [hidden] (ECONNREFUSED).");
    expect(await readFile(path.join(result.run_folder, 'result.json'), 'utf8')).not.toContain('search.example.app');
  });
});
