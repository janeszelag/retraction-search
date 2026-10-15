import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadSnapshot, snapshotBaseName } from '../src/download.js';
import { fakeGitlab } from './helpers/fake-gitlab.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('download helpers', () => {
  it('names snapshots by data date and short commit', () => {
    expect(snapshotBaseName('2026-10-09', 'bc5648dd')).toBe('retraction_watch-2026-10-09-bc5648dd');
  });
});

describe('downloading a snapshot', () => {
  let rawDir;

  beforeEach(async () => {
    rawDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-raw-'));
  });

  afterEach(async () => {
    await rm(rawDir, { recursive: true, force: true });
  });

  const commits = [
    {
      id: 'b'.repeat(40),
      title: 'Retraction Watch data for 2026-10-14',
      committed_date: '2026-10-14T23:00:20.000+00:00',
      file: fixture('sample.csv'),
    },
    {
      id: 'a'.repeat(40),
      title: 'Retraction Watch data for 2026-10-13',
      committed_date: '2026-10-13T23:00:41.000+00:00',
      file: fixture('empty-rows.csv'),
    },
  ];

  it('saves the newest snapshot with a manifest, then skips it when it already has it', async () => {
    const gitlab = fakeGitlab(commits);
    const first = await downloadSnapshot({ fetch: gitlab.fetch, rawDir });
    expect(first).toMatchObject({ dataDate: '2026-10-14', commit: 'bbbbbbbb', fullCommit: 'b'.repeat(40), skipped: false });
    expect(path.basename(first.csvPath)).toBe('retraction_watch-2026-10-14-bbbbbbbb.csv');
    expect((await readFile(first.csvPath)).equals(await readFile(fixture('sample.csv')))).toBe(true);
    const manifest = JSON.parse(await readFile(first.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({ commit: 'b'.repeat(40), data_date: '2026-10-14', bytes: (await stat(fixture('sample.csv'))).size });

    const second = await downloadSnapshot({ fetch: gitlab.fetch, rawDir });
    expect(second.skipped).toBe(true);
  });

  it('saves a given commit', async () => {
    const result = await downloadSnapshot({ commit: 'aaaaaaaa', fetch: fakeGitlab(commits).fetch, rawDir });
    expect(path.basename(result.csvPath)).toBe('retraction_watch-2026-10-13-aaaaaaaa.csv');
  });

  it('fails on a commit that does not exist, and saves nothing', async () => {
    await expect(downloadSnapshot({ commit: 'cccccccc', fetch: fakeGitlab(commits).fetch, rawDir })).rejects.toThrow(
      'GitLab returned 404',
    );
    expect(await readdir(rawDir)).toEqual([]);
  });

  it('fails when the file does not match GitLab’s checksum, and saves nothing', async () => {
    const gitlab = fakeGitlab(commits);
    const corrupt = async (url, init) => {
      const response = await gitlab.fetch(url, init);
      return String(url).includes('/-/raw/') ? new Response(`${await response.text()}extra`) : response;
    };
    await expect(downloadSnapshot({ fetch: corrupt, rawDir })).rejects.toThrow('Checksum mismatch');
    expect(await readdir(rawDir)).toEqual([]);
  });
});
