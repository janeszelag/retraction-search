import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadSnapshot, snapshotBaseName } from '../src/download.js';
import { gitBlobIdOf, sha256Of } from '../src/files.js';
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

  // Wraps the fake GitLab's fetch, letting a test change the headers of the
  // files API's answer.
  const withHeaders = (gitlab, change) => async (url, init) => {
    const response = await gitlab.fetch(url, init);
    if (!String(url).includes('/repository/files/')) {
      return response;
    }
    const headers = new Headers(response.headers);
    change(headers);
    return new Response(null, { headers });
  };

  it('fails when the download does not match GitLab’s file, and saves nothing', async () => {
    const gitlab = fakeGitlab(commits);
    const corrupt = async (url, init) => {
      const response = await gitlab.fetch(url, init);
      return String(url).includes('/-/raw/') ? new Response(`${await response.text()}extra`) : response;
    };
    await expect(downloadSnapshot({ fetch: corrupt, rawDir })).rejects.toThrow("The download doesn't match GitLab's file");
    expect(await readdir(rawDir)).toEqual([]);
  });

  it('still fails on a checksum mismatch when the blob ID matches', async () => {
    const wrongChecksum = withHeaders(fakeGitlab(commits), (headers) => headers.set('x-gitlab-content-sha256', '0'.repeat(64)));
    await expect(downloadSnapshot({ fetch: wrongChecksum, rawDir })).rejects.toThrow('Checksum mismatch');
    expect(await readdir(rawDir)).toEqual([]);
  });

  describe('a file that is not UTF-8 (AC22)', () => {
    const windows1252 = [{ ...commits[0], file: fixture('windows-1252.csv') }];

    it('says so, confirms the download matches GitLab’s file, and saves nothing', async () => {
      const blobId = await gitBlobIdOf(fixture('windows-1252.csv'));
      const error = await downloadSnapshot({ fetch: fakeGitlab(windows1252).fetch, rawDir }).catch((caught) => caught);
      expect(error.message).toBe(
        `Upstream's file isn't valid UTF-8: 47 bytes aren't, the first on line 3. The download matches GitLab's file (git blob ${blobId.slice(0, 8)}), so the problem is in upstream's file, not the download. See docs/data-issues.md#file-format.`,
      );
      expect(error.message).not.toContain('Checksum mismatch');
      expect(await readdir(rawDir)).toEqual([]);
    });

    it('leaves out the match when GitLab reports no blob ID', async () => {
      const noBlobId = withHeaders(fakeGitlab(windows1252), (headers) => headers.delete('x-gitlab-blob-id'));
      const error = await downloadSnapshot({ fetch: noBlobId, rawDir }).catch((caught) => caught);
      expect(error.message).toBe(
        "Upstream's file isn't valid UTF-8: 47 bytes aren't, the first on line 3. See docs/data-issues.md#file-format.",
      );
    });
  });

  describe('a file that starts with a byte-order mark (AC23)', () => {
    it('saves it byte for byte, with the blob ID and SHA-256 GitLab reports', async () => {
      const secondExport = [{ ...commits[0], file: fixture('second-export.csv') }];
      const result = await downloadSnapshot({ fetch: fakeGitlab(secondExport).fetch, rawDir });
      const saved = await readFile(result.csvPath);
      expect(saved.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(saved.equals(await readFile(fixture('second-export.csv')))).toBe(true);
      expect(await gitBlobIdOf(result.csvPath)).toBe(await gitBlobIdOf(fixture('second-export.csv')));
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
      expect(manifest.sha256).toBe(await sha256Of(fixture('second-export.csv')));
    });

    it('still checks the header after the mark, and shows the mark in the error', async () => {
      const fileDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-files-'));
      try {
        const file = path.join(fileDir, 'renamed-id.csv');
        await writeFile(file, '﻿RecordID,Title\n1,Example\n');
        const error = await downloadSnapshot({
          fetch: fakeGitlab([{ ...commits[0], file }]).fetch,
          rawDir,
        }).catch((caught) => caught);
        expect(error.message).toBe(`The downloaded file doesn't start with the expected header: "\\ufeffRecordID,Title"`);
        expect(await readdir(rawDir)).toEqual([]);
      } finally {
        await rm(fileDir, { recursive: true, force: true });
      }
    });
  });
});
