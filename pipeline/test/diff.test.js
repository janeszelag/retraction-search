import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareSnapshots,
  diffDirFor,
  diffMarkdown,
  MAX_REASON_LINES,
  MAX_RECORD_IDS,
  runDiff,
  snapshotName,
} from '../src/diff.js';
import { openDatabase, queryRows, sqlString } from '../src/duckdb.js';

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

// second-export.csv is sample.csv as upstream's second export writes it
// (see fixtures/README.md).
describe('a diff that ignores how an export writes values (AC4, changed 2026-10-25)', () => {
  let workDir;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-diff-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  // A copy of second-export.csv with an edit, written by DuckDB.
  async function editedSecondExport(name, update) {
    const file = path.join(workDir, name);
    const db = await openDatabase();
    await db.run(
      `CREATE TABLE s AS SELECT * FROM read_csv(${sqlString(fixture('second-export.csv'))}, header = true, all_varchar = true, parallel = false)`,
    );
    await db.run(update);
    await db.run(`COPY s TO ${sqlString(file)} (HEADER)`);
    return file;
  }

  it.each([
    ['sample.csv', 'second-export.csv'],
    ['second-export.csv', 'sample.csv'],
  ])('finds no change from %s to %s', async (from, to) => {
    const diff = await compareSnapshots(fixture(from), fixture(to));
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, emptied: 0 });
    expect(diff.records).toEqual([]);
  });

  it('still reports an edited reason, with the published old and new text', async () => {
    const edited = await editedSecondExport(
      'reason-edited.csv',
      `UPDATE s SET Reason = 'Concerns/Issues about Data; Results Not Reproducible;' WHERE "Record ID" = '6'`,
    );
    const diff = await compareSnapshots(fixture('sample.csv'), edited);
    expect(diff.records).toEqual([{ record_id: 6, change: 'changed', columns: ['Reason'], emptied: [] }]);
    expect(diff.values).toEqual([
      {
        record_id: 6,
        column: 'Reason',
        old: 'Results Not Reproducible;',
        new: 'Concerns/Issues about Data; Results Not Reproducible;',
      },
    ]);
  });

  it('counts a filled field that becomes only a line break as emptied', async () => {
    const edited = await editedSecondExport('notes-emptied.csv', `UPDATE s SET Notes = chr(10) WHERE "Record ID" = '69326'`);
    const diff = await compareSnapshots(fixture('sample.csv'), edited);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 1, emptied: 1 });
    expect(diff.records).toEqual([{ record_id: 69326, change: 'changed', columns: ['Notes'], emptied: ['Notes'] }]);
  });

  it('treats an Institution of None as empty, but still reports one that gets a value', async () => {
    const edited = await editedSecondExport(
      'institution-added.csv',
      `UPDATE s SET Institution = 'Example University' WHERE "Record ID" = '34181'`,
    );
    const diff = await compareSnapshots(fixture('second-export.csv'), edited);
    expect(diff.records).toEqual([{ record_id: 34181, change: 'changed', columns: ['Institution'], emptied: [] }]);
  });

  it('still reports a real PubMed ID or date that changed', async () => {
    const edited = await editedSecondExport(
      'ids-edited.csv',
      `UPDATE s SET RetractionPubMedID = '12345678', OriginalPaperDate = '1/2/1753 12:00:00 AM' WHERE "Record ID" = '18930'`,
    );
    const diff = await compareSnapshots(fixture('sample.csv'), edited);
    expect(diff.records).toEqual([
      { record_id: 18930, change: 'changed', columns: ['RetractionPubMedID', 'OriginalPaperDate'], emptied: [] },
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

  it('writes diff.json and diff.md', async () => {
    const outputDir = path.join(root, 'out');
    const { diff } = await runDiff({ fromPath: fixture('sample.csv'), toPath: fixture('sample-next.csv'), outputDir });
    expect(JSON.parse(await readFile(path.join(outputDir, 'diff.json'), 'utf8'))).toEqual(diff);
    expect(await readFile(path.join(outputDir, 'diff.md'), 'utf8')).toBe(diffMarkdown(diff));
  });
});

describe('diff.md (AC5, AC6)', () => {
  let markdown;

  beforeAll(async () => {
    markdown = diffMarkdown(await compareSnapshots(fixture('sample.csv'), fixture('sample-next.csv')));
  });

  it('gives the counts and the changed columns', () => {
    expect(markdown).toContain('| Added | 2 |');
    expect(markdown).toContain('| Removed | 1 |');
    expect(markdown).toContain('| Changed | 5 |');
    expect(markdown).toContain('| With a filled field now empty | 1 |');
    expect(markdown).toContain('| Notes | 1 | 1 |');
  });

  it('gives old and new notice types and reasons', () => {
    expect(markdown).toContain('| 18 | Expression of concern | Retraction |');
    expect(markdown).toContain('| 6 | Results Not Reproducible; | Concerns/Issues about Data;Results Not Reproducible; |');
  });

  it('lists record IDs', () => {
    expect(markdown).toMatch(/## Added records \(2\)\n\n900000301, 900000302\n/);
    expect(markdown).toMatch(/## Removed records \(1\)\n\n102\n/);
    expect(markdown).toContain('| 69326 | Notes | Notes |');
    expect(markdown).toContain('| 4 | URLS | - |');
  });

  it('has no title or author text from the fixtures', async () => {
    const db = await openDatabase();
    const rows = await queryRows(
      db,
      `SELECT Title, Author FROM read_csv([${[fixture('sample.csv'), fixture('sample-next.csv')].map(sqlString).join(', ')}],
         header = true, all_varchar = true, union_by_name = true)`,
    );
    const texts = rows.flatMap((row) => [row.Title, ...(row.Author ?? '').split(';')]).filter((text) => text?.trim());
    expect(texts.length).toBeGreaterThan(400);
    expect(texts.filter((text) => markdown.includes(text.trim()))).toEqual([]);
  });

  it('can start at a lower heading level', () => {
    const nested = diffMarkdown(
      { from: { file: 'a.csv', records: 0 }, to: { file: 'b.csv', records: 0 }, counts: { added: 0, removed: 0, changed: 0, emptied: 0 }, columns: [], values: [], records: [] },
      { level: 2 },
    );
    expect(nested).toMatch(/^## Changes from a\.csv to b\.csv\n/);
    expect(nested).toContain('\n### Added records (0)\n\nNone.\n');
  });
});

describe('diff.md caps (AC6)', () => {
  const range = (start, count) => Array.from({ length: count }, (_, index) => start + index);
  const records = [
    ...range(1, MAX_RECORD_IDS + 50).map((id) => ({ record_id: id, change: 'added', columns: [], emptied: [] })),
    ...range(1000, MAX_RECORD_IDS + 1).map((id) => ({ record_id: id, change: 'removed', columns: [], emptied: [] })),
    ...range(2000, MAX_RECORD_IDS).map((id) => ({ record_id: id, change: 'changed', columns: ['Reason'], emptied: [] })),
    ...range(3000, MAX_REASON_LINES + 100 - MAX_RECORD_IDS).map((id) => ({ record_id: id, change: 'changed', columns: ['Reason', 'RetractionNature'], emptied: [] })),
  ];
  const changedIds = records.filter((record) => record.change === 'changed').map((record) => record.record_id);
  const diff = {
    from: { file: 'a.csv', commit: 'a'.repeat(40), data_date: '2026-10-13', records: 1000 },
    to: { file: 'b.csv', commit: 'b'.repeat(40), data_date: '2026-10-14', records: 1049 },
    counts: { added: MAX_RECORD_IDS + 50, removed: MAX_RECORD_IDS + 1, changed: changedIds.length, emptied: 0 },
    columns: [{ column: 'Reason', changed: changedIds.length, emptied: 0 }],
    values: [
      ...changedIds.map((id) => ({ record_id: id, column: 'Reason', old: 'Old reason;', new: 'New reason;' })),
      ...range(3000, MAX_REASON_LINES + 100 - MAX_RECORD_IDS).map((id) => ({ record_id: id, column: 'RetractionNature', old: 'Expression of concern', new: 'Retraction' })),
    ],
    records,
  };
  const markdown = diffMarkdown(diff);
  const section = (heading) => markdown.slice(markdown.indexOf(heading)).split('\n## ')[0];

  it('names both snapshots by data date and commit', () => {
    expect(markdown).toMatch(/^# Changes from 2026-10-13 \(upstream commit aaaaaaaa\) to 2026-10-14 \(upstream commit bbbbbbbb\)\n/);
  });

  it(`shows ${MAX_RECORD_IDS} record IDs per list, then how many more`, () => {
    const added = section('## Added records');
    expect(added).toContain(`, ${MAX_RECORD_IDS}\n\n…and 50 more in diff.json.`);
    expect(added).not.toContain(`${MAX_RECORD_IDS + 1}`);
    expect(section('## Removed records')).toContain('…and 1 more in diff.json.');
    const changedRows = section('## Changed records (').split('\n').filter((line) => /^\| \d/.test(line));
    expect(changedRows).toHaveLength(MAX_RECORD_IDS);
    expect(section('## Changed records (')).toContain(`…and ${changedIds.length - MAX_RECORD_IDS} more in diff.json.`);
  });

  it(`shows ${MAX_REASON_LINES} reason changes, then how many more`, () => {
    const reasonRows = section('## Reason changes').split('\n').filter((line) => /^\| \d/.test(line));
    expect(reasonRows).toHaveLength(MAX_REASON_LINES);
    expect(section('## Reason changes')).toContain('…and 100 more in diff.json.');
  });

  it('shows every notice type change', () => {
    const rows = section('## Notice type changes').split('\n').filter((line) => /^\| \d/.test(line));
    expect(rows).toHaveLength(MAX_REASON_LINES + 100 - MAX_RECORD_IDS);
    expect(section('## Notice type changes')).not.toContain('more in diff.json');
  });

  it('shows "None." for an empty list', () => {
    const none = diffMarkdown({ ...diff, records: [], values: [], columns: [], counts: { added: 0, removed: 0, changed: 0, emptied: 0 } });
    expect(none).toContain('## Added records (0)\n\nNone.');
    expect(none).toContain('No column changed.');
  });
});
