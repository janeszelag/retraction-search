import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeBlock, failedComment, readLatestResult, resolvedComment } from '../src/alert.js';

const RUN = 'https://github.com/owner/repo/actions/runs/123';
const LOADED = { data_date: '2026-10-14', commit: '1af1bfbb', upstream_commit: '1af1bfbb73f7b45790ac73ffb9e3cda8bce03d70' };
const NEWEST = { data_date: '2026-10-15', commit: '2b2c3d4e', upstream_commit: '2b2c3d4e'.padEnd(40, '0') };

// A failed run's result.json, as runUpdate writes it.
const failed = (overrides = {}) => ({
  outcome: 'failed',
  step: 'import',
  message: "Can't reach Typesense at [hidden] (ECONNREFUSED).",
  before: LOADED,
  target: NEWEST,
  after: null,
  switched_back: null,
  ...overrides,
});

describe('code blocks', () => {
  it('fences a message so Markdown and mentions in it stay inert', () => {
    expect(codeBlock('Journal of @an-account **bold**')).toBe('```\nJournal of @an-account **bold**\n```');
  });

  it('uses a longer fence than any backticks in the message', () => {
    expect(codeBlock('a ``` b ```` c')).toBe('`````\na ``` b ```` c\n`````');
  });
});

describe('the alert for a failed run (AC14)', () => {
  it('names the failed step, quotes the message and links to the run', () => {
    const text = failedComment(failed(), RUN);
    expect(text).toContain('The daily update failed at the **import** step.');
    expect(text).toContain("```\nCan't reach Typesense at [hidden] (ECONNREFUSED).\n```");
    expect(text).toContain('Upstream snapshot: 2026-10-15 (upstream commit 2b2c3d4e). Search still serves 2026-10-14 (upstream commit 1af1bfbb).');
    expect(text).toMatch(/Run: https:\/\/github\.com\/owner\/repo\/actions\/runs\/123$/);
  });

  it('says when search serves the new snapshot because there was nothing to go back to', () => {
    const text = failedComment(failed({ step: 'checks after the switch', before: null, switched_back: false }), RUN);
    expect(text).toContain('There was no previous snapshot to go back to, so search serves the new one.');
  });

  it('says when the server had nothing loaded', () => {
    expect(failedComment(failed({ before: null, target: null }), RUN)).toContain(
      'Upstream snapshot: not found. The server had no snapshot loaded before the run.',
    );
  });

  it('still alerts when the update wrote no result, as when installing failed or time ran out', () => {
    expect(failedComment(null, RUN)).toBe(
      `The daily update stopped before the update command wrote its result: installing failed, the update ran out of time, or the run was cancelled.\n\nRun: ${RUN}`,
    );
  });

  it('says so when the update finished but a later step failed', () => {
    expect(failedComment({ outcome: 'updated', after: NEWEST }, RUN)).toContain(
      'The update itself finished (updated), but a later step of the workflow failed.',
    );
  });
});

describe('the comment that closes the alert (AC14)', () => {
  it('says what the successful run did', () => {
    expect(resolvedComment({ outcome: 'updated', after: NEWEST }, RUN)).toBe(
      `Resolved: this run updated search to 2026-10-15 (upstream commit 2b2c3d4e).\n\nRun: ${RUN}`,
    );
    expect(resolvedComment({ outcome: 'up-to-date', before: LOADED }, RUN)).toBe(
      `Resolved: this run found the server up to date with 2026-10-14 (upstream commit 1af1bfbb).\n\nRun: ${RUN}`,
    );
  });

  it('still resolves without a result', () => {
    expect(resolvedComment(null, RUN)).toBe(`Resolved: this run succeeded.\n\nRun: ${RUN}`);
  });
});

describe('reading the run result', () => {
  let runs;

  beforeEach(async () => {
    runs = await mkdtemp(path.join(tmpdir(), 'retraction-search-alert-'));
  });

  afterEach(async () => {
    await rm(runs, { recursive: true, force: true });
  });

  it('reads result.json from the newest run folder', async () => {
    for (const [folder, outcome] of [
      ['20261015T011700Z', 'failed'],
      ['20261015T071700Z', 'updated'],
    ]) {
      await mkdir(path.join(runs, folder));
      await writeFile(path.join(runs, folder, 'result.json'), JSON.stringify({ outcome }));
    }
    expect(await readLatestResult(runs)).toEqual({ outcome: 'updated' });
  });

  it('returns null when there is no run folder or no result in it', async () => {
    expect(await readLatestResult(path.join(runs, 'missing'))).toBeNull();
    await mkdir(path.join(runs, '20261015T011700Z'));
    expect(await readLatestResult(runs)).toBeNull();
  });
});
