import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareSnapshots, diffDirFor, runDiff, snapshotName } from '../src/diff.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// sample-next.csv is sample.csv with record 102 removed, records 900000301
// and 900000302 added, and one column changed in each of records 4, 6, 18,
// 34181 and 69326 (see fixtures/README.md).
describe('diff of sample.csv → sample-next.csv (AC4, AC5)', () => {
  let diff;

  beforeAll(async () => {
    diff = await compareSnapshots(fixture('sample.csv'), fixture('sample-next.csv'));
  });

  it('counts records added, removed, changed and emptied', () => {
    expect(diff.from).toMatchObject({ file: 'sample.csv', records: 37 });
    expect(diff.to).toMatchObject({ file: 'sample-next.csv', records: 38 });
    expect(diff.counts).toEqual({ added: 2, removed: 1, changed: 5, emptied: 1 });
  });

  it('lists each record with its change and changed columns, by record ID', () => {
    expect(diff.records).toEqual([
      { record_id: 4, change: 'changed', columns: ['URLS'], emptied: [] },
      { record_id: 6, change: 'changed', columns: ['Reason'], emptied: [] },
      { record_id: 18, change: 'changed', columns: ['RetractionNature'], emptied: [] },
      { record_id: 102, change: 'removed', columns: [], emptied: [] },
      // Empty to filled is a change, not an emptied field.
      { record_id: 34181, change: 'changed', columns: ['Institution'], emptied: [] },
      { record_id: 69326, change: 'changed', columns: ['Notes'], emptied: ['Notes'] },
      { record_id: 900000301, change: 'added', columns: [], emptied: [] },
      { record_id: 900000302, change: 'added', columns: [], emptied: [] },
    ]);
  });

  it('counts changed records per column, in the file’s column order', () => {
    expect(diff.columns).toEqual([
      { column: 'Institution', changed: 1, emptied: 0 },
      { column: 'URLS', changed: 1, emptied: 0 },
      { column: 'RetractionNature', changed: 1, emptied: 0 },
      { column: 'Reason', changed: 1, emptied: 0 },
      { column: 'Notes', changed: 1, emptied: 1 },
    ]);
  });

  it('gives old and new text for notice types and reasons only', () => {
    expect(diff.values).toEqual([
      {
        record_id: 6,
        column: 'Reason',
        old: 'Results Not Reproducible;',
        new: 'Concerns/Issues about Data;Results Not Reproducible;',
      },
      { record_id: 18, column: 'RetractionNature', old: 'Expression of concern', new: 'Retraction' },
    ]);
  });
});

describe('diff of unchanged data', () => {
  it('finds nothing when a file is compared with itself', async () => {
    const diff = await compareSnapshots(fixture('sample.csv'), fixture('sample.csv'));
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, emptied: 0 });
    expect([diff.records, diff.columns, diff.values]).toEqual([[], [], []]);
  });

  it('ignores empty rows (spec 001 AC2)', async () => {
    const diff = await compareSnapshots(fixture('sample.csv'), fixture('empty-rows.csv'));
    expect(diff.to.records).toBe(37);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, emptied: 0 });
  });

  it('stops on a file with a missing column, like the cleaning', async () => {
    await expect(compareSnapshots(fixture('sample.csv'), fixture('missing-column.csv'))).rejects.toThrow(
      'expected column "Journal" is missing',
    );
  });
});

describe('diff output', () => {
  let root;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'retraction-search-diff-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('names the folder after both snapshots', () => {
    expect(snapshotName('data/raw/retraction_watch-2026-10-09-bc5648dd.csv')).toBe('2026-10-09-bc5648dd');
    expect(
      diffDirFor('data/raw/retraction_watch-2026-10-13-2cf47753.csv', 'data/raw/retraction_watch-2026-10-14-1af1bfbb.csv', '/d'),
    ).toBe('/d/2026-10-13-2cf47753_to_2026-10-14-1af1bfbb');
  });

  it('writes diff.json', async () => {
    const outputDir = path.join(root, 'out');
    const { diff } = await runDiff({ fromPath: fixture('sample.csv'), toPath: fixture('sample-next.csv'), outputDir });
    expect(JSON.parse(await readFile(path.join(outputDir, 'diff.json'), 'utf8'))).toEqual(diff);
  });
});
