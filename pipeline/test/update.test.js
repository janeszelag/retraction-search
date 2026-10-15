import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCleaning } from '../src/clean.js';
import { repoRoot } from '../src/paths.js';
import {
  checkChangeLimits,
  DEFAULT_VIEW_FILTER,
  expectedCounts,
  MAX_EMPTIED,
  MAX_REMOVED,
  redact,
  runUpdate,
} from '../src/update.js';
import { TypesenseError } from '../src/typesense.js';
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
    // Only the new collection stays (plan trade-off 4, decided after spike S3).
    expect([...typesense.collections.keys()].sort()).toEqual(['meta', result.after.collection].sort());
  });

  it('deletes every other snapshot collection after the checks pass, including ones left from before', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    // A previous collection kept by an earlier version of the command.
    typesense.collections.set('retractions_2026-10-12_cccccccc_20261013T011700Z', { schema: {}, docs: new Map() });
    const logged = [];
    const { result } = await update(typesense, [NEWER, OLDER], { log: (line) => logged.push(line) });

    expect(result.outcome).toBe('updated');
    expect([...typesense.collections.keys()].sort()).toEqual(['meta', result.after.collection].sort());
    expect(logged.filter((line) => line.startsWith('Deleted '))).toHaveLength(2);
    // The deletions come last, after the checks through the alias.
    expect(logged.findIndex((line) => line.startsWith('Deleted '))).toBeGreaterThan(
      logged.findIndex((line) => line.startsWith('Search through the retractions alias matches')),
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
    // Rolling back means fewer records, so it needs --accept-changes too (AC8).
    const { result } = await update(typesense, [NEWER, OLDER], { commit: 'aaaaaaaa', acceptChanges: true });

    expect(result.outcome).toBe('updated');
    expect(result.requested_commit).toBe('aaaaaaaa');
    expect(result.after).toMatchObject({ data_date: '2026-10-13', upstream_commit: OLDER.id });
    expect(result.diff).toMatchObject({ added: 1, removed: 2 });
    expect(result.limits_overridden).toBe(true);
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
    typesense.failRequest = () => new TypesenseError("Can't reach Typesense at https://search.example.app (ECONNREFUSED).");
    const { result } = await update(typesense, [OLDER], { secrets: ['https://search.example.app'] });
    expect(result).toMatchObject({ outcome: 'failed', step: 'read the server' });
    expect(result.message).toBe("Can't reach Typesense at [hidden] (ECONNREFUSED).");
    expect(await readFile(path.join(result.run_folder, 'result.json'), 'utf8')).not.toContain('search.example.app');
  });
});

describe('--server-env, typed as a person would (AC17)', () => {
  // The real command from the repository root, with npm's and the server's
  // variables cleared as in a new terminal. The script runs from pipeline/, so a
  // path that only works from the root shows the script read it, not Node.
  async function npmUpdate(...args) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^npm_/i.test(name) && !['INIT_CWD', 'TYPESENSE_URL', 'TYPESENSE_ADMIN_KEY'].includes(name)),
    );
    try {
      await promisify(execFile)('npm', ['run', 'update', '--', ...args], { cwd: repoRoot, env });
      return { code: 0, stderr: '' };
    } catch (error) {
      return { code: error.code, stderr: error.stderr };
    }
  }

  it('reads a file given relative to the repository root', async () => {
    const file = path.join(root, 'hosted.env');
    await writeFile(file, 'TYPESENSE_URL=http://127.0.0.1:9\n');
    const { code, stderr } = await npmUpdate('--server-env', path.relative(repoRoot, file));
    // The file has no admin key, so the run stops before any request.
    expect(stderr).toContain(`Set TYPESENSE_URL and TYPESENSE_ADMIN_KEY in the environment or in ${file}.`);
    expect(code).toBe(1);
  }, 30_000);

  it('names a missing file in its own message', async () => {
    const file = path.join(root, 'missing.env');
    const { code, stderr } = await npmUpdate('--server-env', path.relative(repoRoot, file));
    expect(stderr).toContain(`Can't find ${file}.`);
    expect(code).toBe(1);
  }, 30_000);
});

// What search serves: the alias target and the meta document.
const served = (typesense) => ({
  alias: typesense.aliases.get('retractions'),
  meta: JSON.stringify(typesense.collections.get('meta')?.docs.get('current') ?? null),
});

describe('failing loudly (AC7)', () => {
  const BROKEN = { ...NEWER, id: 'd'.repeat(40), file: fixture('missing-column.csv') };

  async function failedRun(setup, commits, options) {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    const before = served(typesense);
    const collections = [...typesense.collections.keys()].sort();
    setup?.(typesense);
    const { result } = await update(typesense, commits, options);
    expect(served(typesense)).toEqual(before);
    expect([...typesense.collections.keys()].sort()).toEqual(collections);
    expect(JSON.parse(await readFile(path.join(result.run_folder, 'result.json'), 'utf8'))).toMatchObject({
      outcome: 'failed',
      step: result.step,
    });
    expect(await readFile(path.join(result.run_folder, 'summary.md'), 'utf8')).toContain(`# Failed at the ${result.step} step`);
    return result;
  }

  it('stops at the column check on a file with a missing column', async () => {
    const result = await failedRun(null, [BROKEN, OLDER]);
    expect(result).toMatchObject({ step: 'column check' });
    expect(result.message).toContain('expected column "Journal" is missing');
  });

  it('stops at the download when GitLab fails', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    const before = served(typesense);
    const gitlab = fakeGitlab([NEWER, OLDER]);
    const failing = (url, init) => (String(url).includes('/-/raw/') ? Promise.resolve(new Response('busy', { status: 503 })) : gitlab.fetch(url, init));
    const { result } = await update(typesense, [NEWER, OLDER], { fetch: failing });
    expect(result).toMatchObject({ outcome: 'failed', step: 'download' });
    expect(result.message).toContain('Download failed with status 503');
    expect(served(typesense)).toEqual(before);
  });

  it('stops at the import when Typesense refuses it, and deletes the new collection', async () => {
    const result = await failedRun(
      (typesense) => {
        typesense.failRequest = (method, pathname) =>
          pathname.endsWith('/documents/import') ? new TypesenseError(`Typesense POST ${pathname} failed with HTTP 503: Not Ready or Lagging`, 503) : null;
      },
      [NEWER, OLDER],
    );
    expect(result).toMatchObject({ step: 'import' });
    expect(result.message).toContain('HTTP 503');
  });

  it('stops when the given commit does not exist', async () => {
    const result = await failedRun(null, [NEWER, OLDER], { commit: 'eeeeeeee' });
    expect(result).toMatchObject({ step: 'find the upstream snapshot' });
    expect(result.message).toContain('GitLab returned 404');
  });
});

describe('change limits (AC8)', () => {
  const diffOf = ({ from = 1000, to = 1000, removed = 0, emptied = 0, changed = 0 }) => ({
    from: { records: from },
    to: { records: to },
    counts: { added: 0, removed, changed, emptied },
  });
  const broken = (counts) => checkChangeLimits(diffOf(counts)).filter((limit) => !limit.passed).map((limit) => limit.check);

  it('stops on fewer records, not on the same number', () => {
    expect(broken({ to: 999 })).toEqual(['records']);
    expect(broken({ to: 1000 })).toEqual([]);
  });

  it(`stops on more than ${MAX_REMOVED} records removed`, () => {
    expect(broken({ removed: MAX_REMOVED + 1 })).toEqual(['removed']);
    expect(broken({ removed: MAX_REMOVED })).toEqual([]);
  });

  it(`stops on more than ${MAX_EMPTIED} records with a field emptied`, () => {
    expect(broken({ emptied: MAX_EMPTIED + 1 })).toEqual(['emptied']);
    expect(broken({ emptied: MAX_EMPTIED })).toEqual([]);
  });

  it('stops when more than half of the loaded records changed', () => {
    expect(broken({ changed: 501 })).toEqual(['changed']);
    expect(broken({ changed: 500 })).toEqual([]);
    expect(broken({ from: 37, to: 37, changed: 19 })).toEqual(['changed']);
    expect(broken({ from: 37, to: 37, changed: 18 })).toEqual([]);
  });

  // sample.csv again, as a newer commit after sample-next.csv: one record fewer.
  const SHRUNK = { ...OLDER, id: 'c'.repeat(40), title: 'Retraction Watch data for 2026-10-15', committed_date: '2026-10-15T00:10:00.000+00:00' };

  it('stops a run past a limit after the diff, and still writes the diff and result.json', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [NEWER, OLDER]);
    const before = served(typesense);
    const { result } = await update(typesense, [SHRUNK, NEWER, OLDER]);

    expect(result).toMatchObject({ outcome: 'failed', step: 'change limits', limits_overridden: false });
    expect(result.message).toBe(
      'Compared with the loaded snapshot, the new snapshot has 37 records, fewer than the 38 loaded. Read the diff, then rerun with --accept-changes to let this run through.',
    );
    expect(served(typesense)).toEqual(before);
    const diffFolder = path.join(root, `run-${runs}`, 'diff', '2026-10-14-bbbbbbbb_to_2026-10-15-cccccccc');
    expect(JSON.parse(await readFile(path.join(diffFolder, 'diff.json'), 'utf8')).counts).toMatchObject({ removed: 2 });
    expect(await readFile(path.join(diffFolder, 'diff.md'), 'utf8')).toContain('## Removed records (2)');
    const summary = await readFile(path.join(result.run_folder, 'summary.md'), 'utf8');
    expect(summary).toContain('| Change limits | exceeded |');
    expect(summary).toContain('| records in the new snapshot, which must not fall | 37 | 38 | NO |');
    expect(summary).toContain('## Changes from 2026-10-14');
  });

  it('lets one run through with --accept-changes, and records it', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [NEWER, OLDER]);
    const { result } = await update(typesense, [SHRUNK, NEWER, OLDER], { acceptChanges: true });

    expect(result).toMatchObject({ outcome: 'updated', accept_changes: true, limits_overridden: true });
    expect(result.after.upstream_commit).toBe(SHRUNK.id);
    const summary = await readFile(path.join(result.run_folder, 'summary.md'), 'utf8');
    expect(summary).toContain('| Options | --accept-changes |');
    expect(summary).toContain('| Change limits | exceeded, and let through with --accept-changes |');
  });

  it('records --accept-changes even when no limit was reached', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    const { result } = await update(typesense, [NEWER, OLDER], { acceptChanges: true });
    expect(result).toMatchObject({ outcome: 'updated', accept_changes: true, limits_overridden: false });
  });
});

describe('staleness (AC11)', () => {
  // 2026-10-21 is a Wednesday: Thursday's 23:00 commit is five working days old by then.
  const late = () => new Date('2026-10-21T01:17:00Z');

  it('fails when the newest commit is more than three working days old, even when the server has it', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [NEWER, OLDER]);
    typesense.requests.length = 0;
    const { result } = await update(typesense, [NEWER, OLDER], { now: late });
    expect(result).toMatchObject({ outcome: 'failed', step: 'staleness check' });
    expect(result.message).toContain('is 5 working days old, more than the limit of 3');
    expect(writes(typesense.requests)).toEqual([]);
  });

  it('skips the check for a given commit', async () => {
    const typesense = fakeTypesense();
    const { result } = await update(typesense, [NEWER, OLDER], { now: late, commit: 'bbbbbbbb' });
    expect(result.outcome).toBe('updated');
  });
});

describe('retrying the import (AC9)', () => {
  // Drops the first character of record 1's title in the first collection only, or in every one.
  function dropLetter(typesense, { always = false } = {}) {
    let first = null;
    typesense.onImport = (doc, collection) => {
      first ??= collection;
      return doc.id === '1' && (always || collection === first) ? { ...doc, title: doc.title.slice(1) } : doc;
    };
  }

  it('imports once more when a stored document differs, and reports the retry', async () => {
    const typesense = fakeTypesense();
    dropLetter(typesense);
    const { result } = await update(typesense, [OLDER]);

    expect(result.outcome).toBe('updated');
    expect(result.retries).toEqual([{ at: expect.any(String), step: 'import', message: expect.stringContaining('record 1 (title)') }]);
    expect([...typesense.collections.keys()].sort()).toEqual(['meta', result.after.collection]);
    const summary = await readFile(path.join(result.run_folder, 'summary.md'), 'utf8');
    expect(summary).toContain('| Retries | 1 |');
    expect(summary).toContain('## Retries (AC9)');
  });

  it('fails when the second import is damaged too', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    const before = served(typesense);
    dropLetter(typesense, { always: true });
    const { result } = await update(typesense, [NEWER, OLDER]);

    expect(result).toMatchObject({ outcome: 'failed', step: 'import' });
    expect(result.retries).toHaveLength(1);
    expect(result.message).toContain('record 1 (title)');
    expect(served(typesense)).toEqual(before);
    expect(typesense.collections.size).toBe(2);
  });

  it('does not retry the checks before the import, which depend only on the data', async () => {
    // sample.csv plus a row whose reason differs from another only in capitals.
    const file = path.join(root, 'case.csv');
    const sample = await readFile(fixture('sample.csv'), 'utf8');
    const row2 = sample.split('\n').find((line) => line.startsWith('2,'));
    await writeFile(file, `${sample}${row2.replace(/^2,/, '900000401,').replace('Duplication of/in Image;', 'duplication of/in image;')}\n`);
    const typesense = fakeTypesense();
    const { result } = await update(typesense, [{ ...OLDER, file }]);

    expect(result).toMatchObject({ outcome: 'failed', step: 'import', retries: [] });
    expect(result.message).toContain('differ only in capitals or accents');
    expect(typesense.importBodies).toEqual([]);
  });
});

describe('checks after the switch (AC10)', () => {
  it('counts the cleaned records with DuckDB, as the documents have them', async () => {
    const outputDir = path.join(root, 'clean', '2026-10-13-aaaaaaaa');
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir });
    const docs = (await readFile(path.join(outputDir, 'search-documents.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const noticeTypes = {};
    for (const doc of docs) {
      noticeTypes[doc.notice_type] = (noticeTypes[doc.notice_type] ?? 0) + 1;
    }
    expect(await expectedCounts(path.join(outputDir, 'records.parquet'))).toEqual({
      documents: 37,
      defaultView: docs.filter((doc) => doc.notice_type === 'Retraction' && !doc.is_revision).length,
      noticeTypes,
    });
  });

  it('puts the alias and meta document back and deletes the new collection when a count is wrong', async () => {
    const typesense = fakeTypesense();
    const first = await update(typesense, [OLDER]);
    const before = served(typesense);
    typesense.onSearch = (query, found) => (query.filter_by === DEFAULT_VIEW_FILTER ? { ...found, found: found.found + 1 } : found);
    const { result } = await update(typesense, [NEWER, OLDER]);

    expect(result).toMatchObject({ outcome: 'failed', step: 'checks after the switch', switched_back: true, after: null });
    expect(result.message).toMatch(/the default view finds \d+ records, not \d+\. Search is back on the previous snapshot\.$/);
    expect(served(typesense)).toEqual(before);
    expect([...typesense.collections.keys()].sort()).toEqual(['meta', first.result.after.collection]);
  });

  it('fails when a notice type count differs', async () => {
    const typesense = fakeTypesense();
    await update(typesense, [OLDER]);
    typesense.onSearch = (query, found) =>
      query.facet_by === 'notice_type'
        ? {
            ...found,
            facet_counts: found.facet_counts.map((facet) => ({
              ...facet,
              counts: facet.counts.map((count) => (count.value === 'Correction' ? { ...count, count: count.count - 1 } : count)),
            })),
          }
        : found;
    const { result } = await update(typesense, [NEWER, OLDER]);
    expect(result).toMatchObject({ outcome: 'failed', step: 'checks after the switch' });
    expect(result.message).toMatch(/Correction: \d+ in search, \d+ in DuckDB/);
  });

  it('keeps the new collection after a first load, with nothing to go back to, and still fails', async () => {
    const typesense = fakeTypesense();
    typesense.onSearch = (query, found) => ({ ...found, found: found.found - 1 });
    const { result } = await update(typesense, [OLDER]);

    expect(result).toMatchObject({ outcome: 'failed', step: 'checks after the switch', switched_back: false });
    expect(result.message).toContain('There was no previous snapshot to go back to, so search serves the new one.');
    expect(typesense.aliases.get('retractions')).toMatch(/^retractions_2026-10-13_aaaaaaaa_/);
    expect(await readFile(path.join(result.run_folder, 'summary.md'), 'utf8')).toContain(
      'There was no previous snapshot to go back to, so search serves the new one.',
    );
  });
});
